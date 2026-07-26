import { prisma } from '../../lib/prisma';
import { logger } from '../../config/logger';
import { env } from '../../config/env';
import { createNotification } from '../notifications/notifications.service';
import { emitToUser } from '../../sockets/socket.server';
import { roundMoney } from '../../utils/money';
import * as flutterwave from './flutterwave.provider';
import { MobileMoneyNetwork } from './flutterwave.provider';

export type PaymentMethodInput = 'MTN_MOBILE_MONEY' | 'AIRTEL_MONEY' | 'CARD' | 'BANK_TRANSFER';

interface InitiatePaymentParams {
  amountUsd: number;
  currency: string;
  method: PaymentMethodInput;
  phone?: string;
  email: string;
  fullName: string;
  txRef: string;
}

/**
 * Shared by deposits and package purchases, which previously each duplicated this exact
 * mobile-money-vs-hosted-checkout branch independently. One implementation now, one place to fix
 * if Flutterwave's API shape ever changes.
 */
export async function initiatePayment(params: InitiatePaymentParams): Promise<{ redirectUrl: string | null; providerStatus: string }> {
  const isMobileMoney = params.method === 'MTN_MOBILE_MONEY' || params.method === 'AIRTEL_MONEY';

  if (isMobileMoney) {
    if (!params.phone) throw new Error('Phone number is required for mobile money payments');
    const network: MobileMoneyNetwork = params.method === 'MTN_MOBILE_MONEY' ? 'MTN' : 'AIRTEL';
    const charge = await flutterwave.chargeMobileMoney({
      amountUsd: params.amountUsd,
      currency: params.currency,
      phone: params.phone,
      email: params.email,
      fullName: params.fullName,
      network,
      txRef: params.txRef,
    });
    return { redirectUrl: null, providerStatus: charge.data.status };
  }

  const checkout = await flutterwave.createHostedCheckout({
    amountUsd: params.amountUsd,
    currency: params.currency,
    email: params.email,
    fullName: params.fullName,
    txRef: params.txRef,
    redirectUrl: `${env.APP_BASE_URL}/nexus-dashboard-mobile.html`,
  });
  return { redirectUrl: checkout.data.link, providerStatus: 'pending' };
}

interface FlutterwaveWebhookPayload {
  event: string;
  data: {
    id: number;
    tx_ref?: string;
    reference?: string;
    status: string;
    amount: number;
    currency: string;
  };
}

/**
 * Records the webhook and dispatches it. Every code path — success, no-op, or failure — leaves a
 * permanent WebhookEvent row (audit trail independent of ephemeral logs), and re-throws on
 * failure so the caller can respond with a 5xx, which is what makes Flutterwave's own retry
 * mechanism kick in for transient failures instead of the event being silently lost.
 */
export async function handleFlutterwaveWebhook(payload: FlutterwaveWebhookPayload) {
  const providerRef = payload.data.tx_ref ?? payload.data.reference ?? null;

  const auditRow = await prisma.webhookEvent.create({
    data: {
      eventType: payload.event,
      providerRef,
      signatureValid: true, // the controller only calls this after verifying the signature
      status: 'RECEIVED',
      payload: payload as unknown as object,
    },
  });

  try {
    let outcome: 'PROCESSED' | 'IGNORED' = 'IGNORED';

    if (payload.event === 'charge.completed') {
      outcome = await handleChargeCompleted(payload.data);
    } else if (payload.event === 'transfer.completed') {
      outcome = await handleTransferCompleted(payload.data);
    } else {
      logger.info({ event: payload.event }, 'Unhandled Flutterwave webhook event type — ignored');
    }

    await prisma.webhookEvent.update({ where: { id: auditRow.id }, data: { status: outcome } });
  } catch (err) {
    await prisma.webhookEvent.update({
      where: { id: auditRow.id },
      data: { status: 'FAILED', errorMessage: (err as Error).message },
    });
    throw err; // propagate so the controller responds with a 5xx and Flutterwave retries
  }
}

async function handleChargeCompleted(data: FlutterwaveWebhookPayload['data']): Promise<'PROCESSED' | 'IGNORED'> {
  const providerRef = data.tx_ref;
  if (!providerRef) return 'IGNORED';

  const transaction = await prisma.transaction.findUnique({
    where: { providerRef },
    include: { userPackage: true },
  });
  if (!transaction) return 'IGNORED';

  // Never trust the webhook body alone — re-verify the transaction directly with Flutterwave.
  const verification = await flutterwave.verifyTransaction(String(data.id));
  const isSuccessful = verification.data.status === 'successful';
  const newStatus = isSuccessful ? 'COMPLETED' : 'FAILED';

  // Everything below — the claim AND the side effects — runs as one atomic DB transaction.
  // The claim can't be a separate round-trip before this: if the process crashed between "mark
  // COMPLETED" and "credit the balance", the transaction would be stuck COMPLETED with no money
  // ever credited. Keeping both in the same transaction means either both happen or neither does.
  const result = await prisma.$transaction(async (tx) => {
    // Atomic compare-and-swap: only proceed if THIS call is the one that flips PENDING → terminal.
    // Two near-simultaneous deliveries of the same webhook (normal for at-least-once delivery, not
    // exotic) would otherwise both read status === 'PENDING' before either commits, and both would
    // credit the balance — a real double-processing bug, not a theoretical one.
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
    logger.info({ transactionId: transaction.id }, 'Webhook for already-processed transaction — ignored');
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

async function handleTransferCompleted(data: FlutterwaveWebhookPayload['data']): Promise<'PROCESSED' | 'IGNORED'> {
  const providerRef = data.reference;
  if (!providerRef) return 'IGNORED';

  const transaction = await prisma.transaction.findUnique({ where: { providerRef } });
  if (!transaction || transaction.type !== 'WITHDRAWAL') return 'IGNORED';

  const isSuccessful = data.status === 'SUCCESSFUL';
  const newStatus = isSuccessful ? 'COMPLETED' : 'FAILED';

  const result = await prisma.$transaction(async (tx) => {
    // Same atomic compare-and-swap reasoning as handleChargeCompleted above, and same reason the
    // refund has to live in this same transaction rather than run afterward.
    const claimed = await tx.transaction.updateMany({
      where: { id: transaction.id, status: 'PENDING' },
      data: { status: newStatus },
    });
    if (claimed.count === 0) return 'IGNORED' as const;

    if (!isSuccessful) {
      // Balance was deducted up-front when the withdrawal was requested; refund it since the payout failed.
      await tx.user.update({
        where: { id: transaction.userId },
        data: { balanceUsd: { increment: transaction.amountUsd } },
      });
    }

    return 'PROCESSED' as const;
  });

  if (result === 'IGNORED') {
    logger.info({ transactionId: transaction.id }, 'Webhook for already-processed transaction — ignored');
    return 'IGNORED';
  }

  await createNotification({
    userId: transaction.userId,
    type: 'WITHDRAWAL',
    icon: isSuccessful ? 'fa-money-bill-transfer' : 'fa-triangle-exclamation',
    color: isSuccessful ? 'gold' : 'red',
    title: isSuccessful ? 'Withdrawal processed' : 'Withdrawal failed',
    description: isSuccessful
      ? `Your withdrawal of $${Number(transaction.amountUsd).toLocaleString()} has been sent.`
      : `Your withdrawal of $${Number(transaction.amountUsd).toLocaleString()} failed and has been refunded to your balance.`,
  });

  emitToUser(transaction.userId, 'wallet:update', { transactionId: transaction.id, status: newStatus });
  return 'PROCESSED';
}
