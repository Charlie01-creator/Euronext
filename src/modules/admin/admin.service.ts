import { prisma } from '../../lib/prisma';
import { ApiError } from '../../utils/ApiError';
import { createNotification } from '../notifications/notifications.service';
import { emitToUser } from '../../sockets/socket.server';

export async function listPendingWithdrawals() {
  return prisma.transaction.findMany({
    where: { type: 'WITHDRAWAL', status: 'PENDING' },
    orderBy: { createdAt: 'asc' }, // oldest first — first requested, first reviewed
    include: {
      user: { select: { id: true, fullName: true, email: true, phone: true, balanceUsd: true } },
    },
  });
}

/**
 * Marks a withdrawal as paid. This does not send any money itself — the admin has already sent
 * it through their own channel (mobile money, bank transfer) outside this app, and is confirming
 * that here. There is deliberately no automated payout call: Pesapal (which replaced Flutterwave
 * for every other payment flow) has no public disbursement API, and the product owner specifically
 * wants to be the one who decides whether and when each withdrawal actually goes out.
 */
export async function approveWithdrawal(transactionId: string, adminUserId: string) {
  const transaction = await prisma.transaction.findUnique({ where: { id: transactionId } });
  if (!transaction || transaction.type !== 'WITHDRAWAL') throw ApiError.notFound('Withdrawal not found');
  if (transaction.status !== 'PENDING') throw ApiError.badRequest('This withdrawal has already been resolved');

  const claimed = await prisma.transaction.updateMany({
    where: { id: transactionId, status: 'PENDING' },
    data: { status: 'COMPLETED' },
  });
  if (claimed.count === 0) throw ApiError.badRequest('This withdrawal has already been resolved');

  await createNotification({
    userId: transaction.userId,
    type: 'WITHDRAWAL',
    icon: 'fa-money-bill-transfer',
    color: 'gold',
    title: 'Withdrawal approved',
    description: `Your withdrawal of $${Number(transaction.amountUsd).toLocaleString()} has been sent.`,
  });
  emitToUser(transaction.userId, 'wallet:update', { transactionId: transaction.id, status: 'COMPLETED' });

  return prisma.transaction.findUnique({ where: { id: transactionId } });
}

/** Rejects a withdrawal and refunds the reserved balance back to the user. */
export async function rejectWithdrawal(transactionId: string, reason: string | undefined) {
  const transaction = await prisma.transaction.findUnique({ where: { id: transactionId } });
  if (!transaction || transaction.type !== 'WITHDRAWAL') throw ApiError.notFound('Withdrawal not found');
  if (transaction.status !== 'PENDING') throw ApiError.badRequest('This withdrawal has already been resolved');

  await prisma.$transaction(async (tx) => {
    const claimed = await tx.transaction.updateMany({
      where: { id: transactionId, status: 'PENDING' },
      data: { status: 'FAILED', failureReason: reason ?? 'Rejected by admin' },
    });
    if (claimed.count === 0) throw ApiError.badRequest('This withdrawal has already been resolved');

    await tx.user.update({
      where: { id: transaction.userId },
      data: { balanceUsd: { increment: transaction.amountUsd } },
    });
  });

  await createNotification({
    userId: transaction.userId,
    type: 'WITHDRAWAL',
    icon: 'fa-triangle-exclamation',
    color: 'red',
    title: 'Withdrawal rejected',
    description: `Your withdrawal of $${Number(transaction.amountUsd).toLocaleString()} was rejected and refunded to your balance.${reason ? ` Reason: ${reason}` : ''}`,
  });
  emitToUser(transaction.userId, 'wallet:update', { transactionId: transaction.id, status: 'FAILED' });

  return prisma.transaction.findUnique({ where: { id: transactionId } });
}
