import { z } from 'zod';
import { Router, Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { requireAuth } from '../../middleware/auth.middleware';
import { validate } from '../../middleware/validate.middleware';
import { catchAsync } from '../../utils/catchAsync';
import { createNotification } from '../notifications/notifications.service';

// ── Validation ───────────────────────────────────────────────────
const toggleTwoFactorSchema = z.object({
  body: z.object({ enabled: z.boolean() }),
  query: z.object({}).optional(),
  params: z.object({}).optional(),
});

// ── Service ──────────────────────────────────────────────────────
async function getOverview(userId: string) {
  const [user, lastLogin, deviceCount, deposits, withdrawals, pending] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId } }),
    prisma.loginActivity.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } }),
    prisma.loginActivity.groupBy({ by: ['device'], where: { userId } }),
    prisma.transaction.aggregate({ where: { userId, type: 'DEPOSIT', status: 'COMPLETED' }, _sum: { amountUsd: true } }),
    prisma.transaction.aggregate({ where: { userId, type: 'WITHDRAWAL', status: 'COMPLETED' }, _sum: { amountUsd: true } }),
    prisma.transaction.count({ where: { userId, status: 'PENDING' } }),
  ]);

  return {
    kycStatus: user.kycStatus,
    twoFactorEnabled: user.twoFactorEnabled,
    lastLoginAt: lastLogin?.createdAt ?? null,
    trustedDeviceCount: deviceCount.length,
    totalDepositsUsd: Number(deposits._sum.amountUsd ?? 0),
    totalWithdrawalsUsd: Number(withdrawals._sum.amountUsd ?? 0),
    pendingTransactions: pending,
  };
}

async function getLoginHistory(userId: string) {
  return prisma.loginActivity.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });
}

async function setTwoFactor(userId: string, enabled: boolean) {
  await prisma.user.update({ where: { id: userId }, data: { twoFactorEnabled: enabled } });
  await createNotification({
    userId,
    type: 'SECURITY',
    icon: 'fa-shield-halved',
    color: enabled ? 'green' : 'red',
    title: enabled ? 'Two-factor authentication enabled' : 'Two-factor authentication disabled',
    description: enabled
      ? 'Your account now requires a second verification step to sign in.'
      : 'Two-factor authentication has been turned off for your account.',
  });
}

// ── Controller ───────────────────────────────────────────────────
/**
 * @openapi
 * /security/overview:
 *   get:
 *     tags: [Security]
 *     summary: Trust Center overview — KYC, 2FA, financial transparency figures
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Security overview }
 */
const overviewHandler = catchAsync(async (req: Request, res: Response) => {
  const data = await getOverview(req.user!.id);
  res.json({ success: true, data });
});

/**
 * @openapi
 * /security/login-history:
 *   get:
 *     tags: [Security]
 *     summary: Recent login activity
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Login history }
 */
const loginHistoryHandler = catchAsync(async (req: Request, res: Response) => {
  const data = await getLoginHistory(req.user!.id);
  res.json({ success: true, data });
});

/**
 * @openapi
 * /security/two-factor:
 *   patch:
 *     tags: [Security]
 *     summary: Enable or disable two-factor authentication
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       204: { description: Updated }
 */
const twoFactorHandler = catchAsync(async (req: Request, res: Response) => {
  await setTwoFactor(req.user!.id, req.body.enabled);
  res.status(204).send();
});

// ── Routes ───────────────────────────────────────────────────────
const router = Router();
router.use(requireAuth);
router.get('/overview', overviewHandler);
router.get('/login-history', loginHistoryHandler);
router.patch('/two-factor', validate(toggleTwoFactorSchema), twoFactorHandler);

export default router;
