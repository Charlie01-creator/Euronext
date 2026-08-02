import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import { Router, Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { requireAuth } from '../../middleware/auth.middleware';
import { validate } from '../../middleware/validate.middleware';
import { requireIdempotencyKey } from '../../middleware/idempotency.middleware';
import { catchAsync } from '../../utils/catchAsync';
import { ApiError } from '../../utils/ApiError';
import * as currencyService from '../currency/currency.service';
import { createNotification } from '../notifications/notifications.service';
import { parsePagination, paginatedResponse, resolveSort, PaginationParams } from '../../utils/pagination';

// ── Validation ───────────────────────────────────────────────────
const createWithdrawalSchema = z
  .object({
    body: z.object({
      amount: z.number().positive('Amount must be greater than zero'),
      currency: z.string().length(3).default('USD'),
      method: z.enum(['MTN_MOBILE_MONEY', 'AIRTEL_MONEY', 'BANK_TRANSFER']),
      phone: z.string().min(7).max(20).optional(),
      bankCode: z.string().optional(),
      accountNumber: z.string().optional(),
      accountHolderName: z.string().optional(),
    }),
    query: z.object({}).optional(),
    params: z.object({}).optional(),
  })
  .refine((data) => data.body.method === 'BANK_TRANSFER' || Boolean(data.body.phone), {
    message: 'Phone number is required for mobile money withdrawals',
    path: ['body', 'phone'],
  })
  .refine(
    (data) =>
      data.body.method !== 'BANK_TRANSFER' ||
      (Boolean(data.body.accountNumber) && Boolean(data.body.accountHolderName)),
    { message: 'Bank account number and account holder name are required', path: ['body', 'accountNumber'] }
  );

const MINIMUM_WITHDRAWAL_USD = 10;

// ── Service ──────────────────────────────────────────────────────
/**
 * Withdrawals are no longer paid out automatically — Pesapal (which replaced Flutterwave for
 * every other payment flow) has no public disbursement API, and the product owner has chosen to
 * personally review and approve every payout regardless. This function only reserves the funds
 * and records the destination details; an admin (see src/modules/admin) approves or rejects it
 * from there, sending the money through their own channel outside this app.
 */
async function createWithdrawal(userId: string, input: z.infer<typeof createWithdrawalSchema>['body']) {
  const amountUsd = await currencyService.toUsd(input.amount, input.currency);
  if (amountUsd < MINIMUM_WITHDRAWAL_USD) {
    throw ApiError.badRequest(`Minimum withdrawal is ${MINIMUM_WITHDRAWAL_USD} USD equivalent`);
  }

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (Number(user.balanceUsd) < amountUsd) {
    throw ApiError.badRequest('Insufficient balance for this withdrawal');
  }

  const reference = `wd_${userId}_${uuid().slice(0, 10)}`;
  const destination =
    input.method === 'BANK_TRANSFER'
      ? { bankCode: input.bankCode, accountNumber: input.accountNumber, accountHolderName: input.accountHolderName }
      : { phone: input.phone };

  // Deduct up-front so the same funds can't be requested twice while awaiting admin review.
  // If an admin rejects it, this is refunded — see admin.service.ts.
  const transaction = await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { balanceUsd: { decrement: amountUsd } } });
    return tx.transaction.create({
      data: {
        userId,
        type: 'WITHDRAWAL',
        status: 'PENDING',
        method: input.method,
        amountUsd,
        currency: input.currency,
        providerRef: reference,
        destination,
      },
    });
  });

  await createNotification({
    userId,
    type: 'WITHDRAWAL',
    icon: 'fa-money-bill-transfer',
    color: 'gold',
    title: 'Withdrawal requested',
    description: `Your withdrawal of $${amountUsd.toLocaleString()} has been submitted and is awaiting review.`,
  });

  return transaction;
}

const TRANSACTION_STATUSES = ['PENDING', 'COMPLETED', 'FAILED'] as const;

async function listWithdrawals(userId: string, pagination: PaginationParams, status?: (typeof TRANSACTION_STATUSES)[number]) {
  const where = { userId, type: 'WITHDRAWAL' as const, ...(status ? { status } : {}) };
  const [items, total] = await Promise.all([
    prisma.transaction.findMany({
      where,
      orderBy: resolveSort(pagination, ['createdAt', 'amountUsd', 'status'], 'createdAt'),
      skip: pagination.skip,
      take: pagination.limit,
    }),
    prisma.transaction.count({ where }),
  ]);
  return paginatedResponse(items, total, pagination);
}

// ── Controller ───────────────────────────────────────────────────
/**
 * @openapi
 * /withdrawals:
 *   post:
 *     tags: [Withdrawals]
 *     summary: Request a withdrawal to MTN, Airtel, or a bank account — submitted for admin review, not paid out automatically
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: header, name: Idempotency-Key, required: true, schema: { type: string } }
 *     responses:
 *       201: { description: Withdrawal requested, awaiting admin approval }
 *   get:
 *     tags: [Withdrawals]
 *     summary: List the current user's withdrawal history
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Withdrawal list }
 */
const createHandler = catchAsync(async (req: Request, res: Response) => {
  const result = await createWithdrawal(req.user!.id, req.body);
  res.status(201).json({ success: true, data: result });
});

const listHandler = catchAsync(async (req: Request, res: Response) => {
  const pagination = parsePagination(req.query);
  const rawStatus = req.query.status;
  const status =
    typeof rawStatus === 'string' && TRANSACTION_STATUSES.includes(rawStatus as any)
      ? (rawStatus as (typeof TRANSACTION_STATUSES)[number])
      : undefined;
  const result = await listWithdrawals(req.user!.id, pagination, status);
  res.json({ success: true, data: result });
});

// ── Routes ───────────────────────────────────────────────────────
const router = Router();
router.use(requireAuth);
router.get('/', listHandler);
router.post('/', requireIdempotencyKey, validate(createWithdrawalSchema), createHandler);

export default router;
