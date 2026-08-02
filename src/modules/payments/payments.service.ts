import { prisma } from '../../lib/prisma';
import { logger } from '../../config/logger';
import { createNotification } from '../notifications/notifications.service';
import { emitToUser } from '../../sockets/socket.server';
import { roundMoney } from '../../utils/money';
import * as pesapal from './pesapal.provider';

const CURRENCY_TO_COUNTRY: Record<string, string> = { UGX: 'UG', KES: 'KE', TZS: 'TZ' };

interface InitiatePaymentParams {
  amountUsd: number;
  currency: string;
  email: string;
  fullName: string;
  phone?: string;
  txRef: string;
  description: string;
}

/**
 * Shared by deposits and package purchases. Pesapal's hosted checkout shows every available
 * payment method (mobile money, card, bank) on one page — unlike the previous Flutterwave
 * integration, the app no longer needs to know or ask which method the user wants up front.
 */
export async function initiatePayment(params: InitiatePaymentParams): Promise<{ redirectUrl: string }> {
  const [firstName, ...rest] = params.fullName.trim().split(' ');
  const lastName = rest.join(' ') || firstName;
  const countryCode = CURRENCY_TO_COUNTRY[params.currency] ?? 'UG';

  const order = await pesapal.submitOrder({
    merchantReference: params.txRef,
    amount: params.amountUsd,
    currency: params.currency,
    description: params.description,
    email: params.email,
    phone: params.phone,
    firstName: firstName || 'NexusCapital',
    lastName,
    countryCode,
  });

  return { redirectUrl: order.redirect_url };
}

/**
 * Records the IPN and dispatches it. Every code path — success, no-op, or failure — leaves a
 * permanent WebhookEvent row (audit trail independent of ephemeral logs), and re-throws on
 * failure so the caller can respond accordingly.
 */
export async function handlePesapalIpn(orderTrackingId: string, orderMerchantReference: string) {
  const auditRow = await prisma.webhookEvent.create({
    data: {
      provider: 'pesapal',
      eventType: 'IPNCHANGE',
      providerRef: orderMerchantReference,
      signatureValid: true, // Pesapal's IPN has no signature to verify — status is confirmed by re-querying GetTransactionStatus directly, which serves the same trust purpose
      status: 'RECEIVED',
      payload: { orderTrackingId, orderMerchantReference },
    },
  });

  try {
    const outcome = await handlePaymentNotification(orderTrackingId, orderMerchantReference);
    await prisma.webhookEvent.update({ where: { id: auditRow.id }, data: { status: outcome } });
    return outcome;
  } catch (err) {
    await prisma.webhookEvent.update({
      where: { id: auditRow.id },
      data: { status: 'FAILED', errorMessage: (err as Error).message },
    });
    throw err;
  }
}

async function handlePaymentNotification(
  orderTrackingId: string,
  orderMerchantReference: string
): Promise<'PROCESSED' | 'IGNORED'> {
  const transaction = await prisma.transaction.findUnique({
    where: { providerRef: orderMerchantReference },
    include: { userPackage: true },
  });
  if (!transaction) return 'IGNORED';

  // Never trust the IPN callback's claim alone — re-verify directly with Pesapal.
  const verification = await pesapal.getTransactionStatus(orderTrackingId);
  const isSuccessful = verification.payment_status_description === 'COMPLETED';
  // PENDING/INVALID aren't terminal — only act on a definitive outcome. A still-pending status
  // means Pesapal hasn't finished processing yet; there will be a follow-up IPN call later.
  const isTerminal = ['COMPLETED', 'FAILED', 'INVALID', 'REVERSED'].includes(verification.payment_status_description);
  if (!isTerminal) return 'IGNORED';

  const newStatus = isSuccessful ? 'COMPLETED' : 'FAILED';

  // Everything below — the claim AND the side effects — runs as one atomic DB transaction, for
  // the same reason as before: a crash between "mark COMPLETED" and "credit the balance" must not
  // be possible to observe as a half-applied state.
  const result = await prisma.$transaction(async (tx) => {
    // Atomic compare-and-swap: only proceed if THIS call is the one that flips PENDING → terminal.
    // Pesapal, like any provider, can redeliver the same IPN more than once — this makes a
    // redelivery a safe no-op instead of a double-credit.
    const claimed = await tx.transaction.updateMany({
      where: { id: transaction.id, status: 'PENDING' },
      data: { status: newStatus },
    });
    if (claimed.count === 0) return 'IGNORED' as const;

    if (!isSuccessful) {
      if (transaction.userPackageId) {
        await tx.userPackage.update({ where: { id: transaction.userPackageId }, data: { status: 'CANCELLED' } });
      }
      return 'PROCESSED' as const;
    }

    if (transaction.type === 'DEPOSIT') {
      await tx.user.update({
        where: { id: transaction.userId },
        data: { balanceUsd: { increment: transaction.amountUsd } },
      });
    }

    if (transaction.type === 'PACKAGE_PURCHASE' && transaction.userPackageId) {
      await tx.userPackage.update({ where: { id: transaction.userPackageId }, data: { status: 'ACTIVE' } });

      // referral commission: 7% of the deposit goes to whoever referred this user, once per qualifying deposit
      const buyer = await tx.user.findUnique({ where: { id: transaction.userId } });
      if (buyer?.referredById) {
        const referral = await tx.referral.findUnique({ where: { referredId: buyer.id } });
        if (referral) {
          const commissionAmount = roundMoney(Number(transaction.amountUsd) * 0.07);
          const commissionTx = await tx.transaction.create({
            data: {
              userId: referral.referrerId,
              type: 'COMMISSION',
              status: 'COMPLETED',
              amountUsd: commissionAmount,
            },
          });
          await tx.commission.create({
            data: {
              referralId: referral.id,
              earnerId: referral.referrerId,
              transactionId: commissionTx.id,
              ratePercent: 7,
              amountUsd: commissionAmount,
            },
          });
          await tx.referral.update({ where: { id: referral.id }, data: { status: 'PAID' } });
          await tx.user.update({
            where: { id: referral.referrerId },
            data: { balanceUsd: { increment: commissionAmount } },
          });
        }
      }
    }

    return 'PROCESSED' as const;
  });

  if (result === 'IGNORED') {
    logger.info({ transactionId: transaction.id }, 'IPN for already-processed transaction — ignored');
    return 'IGNORED';
  }

  const notifType = transaction.type === 'DEPOSIT' ? 'DEPOSIT' : 'PACKAGE';
  await createNotification({
    userId: transaction.userId,
    type: isSuccessful ? notifType : 'SECURITY',
    icon: isSuccessful ? 'fa-circle-check' : 'fa-triangle-exclamation',
    color: isSuccessful ? 'green' : 'red',
    title: isSuccessful ? 'Payment confirmed' : 'Payment failed',
    description: isSuccessful
      ? `Your payment of $${Number(transaction.amountUsd).toLocaleString()} has been confirmed.`
      : `Your payment of $${Number(transaction.amountUsd).toLocaleString()} could not be completed.`,
  });

  emitToUser(transaction.userId, 'wallet:update', { transactionId: transaction.id, status: newStatus });
  return 'PROCESSED';
}
