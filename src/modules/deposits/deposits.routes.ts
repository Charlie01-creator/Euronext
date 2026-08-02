import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import { Router, Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { requireAuth } from '../../middleware/auth.middleware';
import { validate } from '../../middleware/validate.middleware';
import { requireIdempotencyKey } from '../../middleware/idempotency.middleware';
import { catchAsync } from '../../utils/catchAsync';
import { ApiError } from '../../utils/ApiError';
import { initiatePayment } from '../payments/payments.service';
import * as currencyService from '../currency/currency.service';
import { parsePagination, paginatedResponse, resolveSort, PaginationParams } from '../../utils/pagination';

// ── Validation ───────────────────────────────────────────────────
const createDepositSchema = z.object({
  body: z.object({
    amount: z.number().positive('Amount must be greater than zero'),
    currency: z.string().length(3).default('USD'),
  }),
  query: z.object({}).optional(),
  params: z.object({}).optional(),
});

const TRANSACTION_STATUSES = ['PENDING', 'COMPLETED', 'FAILED'] as const;

const MINIMUM_DEPOSIT_USD = 10;

// ── Service ──────────────────────────────────────────────────────
async function createDeposit(userId: string, input: z.infer<typeof createDepositSchema>['body']) {
  const amountUsd = await currencyService.toUsd(input.amount, input.currency);
  if (amountUsd < MINIMUM_DEPOSIT_USD) {
    throw ApiError.badRequest(`Minimum deposit is ${MINIMUM_DEPOSIT_USD} USD equivalent`);
  }

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const txRef = `dep_${userId}_${uuid().slice(0, 10)}`;

  const transaction = await prisma.transaction.create({
    data: {
      userId,
      type: 'DEPOSIT',
      status: 'PENDING',
      amountUsd,
      currency: input.currency,
      providerRef: txRef,
    },
  });

  const { redirectUrl } = await initiatePayment({
    amountUsd,
    currency: input.currency,
    email: user.email,
    fullName: user.fullName,
    phone: user.phone ?? undefined,
    txRef,
    description: 'NexusCapital deposit',
  });

  return { transaction, redirectUrl };
}

async function listDeposits(userId: string, pagination: PaginationParams, status?: (typeof TRANSACTION_STATUSES)[number]) {
  const where = { userId, type: 'DEPOSIT' as const, ...(status ? { status } : {}) };
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
 * /deposits:
 *   post:
 *     tags: [Deposits]
 *     summary: Initiate a deposit — redirects to Pesapal's hosted checkout, where the user picks their own payment method (mobile money, card, or bank)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: header, name: Idempotency-Key, required: true, schema: { type: string } }
 *     responses:
 *       201: { description: Deposit initiated, redirectUrl points to the Pesapal checkout page }
 *   get:
 *     tags: [Deposits]
 *     summary: List the current user's deposit history, paginated and optionally filtered by status
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, default: 20, maximum: 100 } }
 *       - { in: query, name: status, schema: { type: string, enum: [PENDING, COMPLETED, FAILED] } }
 *     responses:
 *       200: { description: Paginated deposit list }
 */
const createHandler = catchAsync(async (req: Request, res: Response) => {
  const result = await createDeposit(req.user!.id, req.body);
  res.status(201).json({ success: true, data: result });
});

const listHandler = catchAsync(async (req: Request, res: Response) => {
  const pagination = parsePagination(req.query);
  const rawStatus = req.query.status;
  const status =
    typeof rawStatus === 'string' && TRANSACTION_STATUSES.includes(rawStatus as any)
      ? (rawStatus as (typeof TRANSACTION_STATUSES)[number])
      : undefined;
  const result = await listDeposits(req.user!.id, pagination, status);
  res.json({ success: true, data: result });
});

// ── Routes ───────────────────────────────────────────────────────
const router = Router();
router.use(requireAuth);
router.get('/', listHandler);
router.post('/', requireIdempotencyKey, validate(createDepositSchema), createHandler);

export default router;
