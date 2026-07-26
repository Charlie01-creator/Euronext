import { Router, Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { requireAuth } from '../../middleware/auth.middleware';
import { catchAsync } from '../../utils/catchAsync';

// ── Service ──────────────────────────────────────────────────────
async function getReferralOverview(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { referralCode: true },
  });

  const referrals = await prisma.referral.findMany({
    where: { referrerId: userId },
    include: {
      commissions: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  const referredUsers = await prisma.user.findMany({
    where: { referredById: userId },
    select: { id: true, fullName: true, createdAt: true },
  });

  const referredMap = new Map(referredUsers.map((u) => [u.id, u]));

  const rows = referrals.map((r) => {
    const referredUser = referredMap.get(r.referredId);
    const totalCommission = r.commissions.reduce((sum, c) => sum + Number(c.amountUsd), 0);
    return {
      name: referredUser?.fullName ?? 'Unknown',
      joinedAt: referredUser?.createdAt ?? r.createdAt,
      status: r.status,
      commissionUsd: totalCommission,
    };
  });

  const totalCommissions = rows.reduce((sum, r) => sum + r.commissionUsd, 0);
  const active = rows.filter((r) => r.status === 'PAID').length;
  const pending = rows.filter((r) => r.status === 'PENDING').length;

  return {
    referralCode: user.referralCode,
    referralLink: `https://nexuscapital.com/join?ref=${user.referralCode}`,
    stats: {
      total: rows.length,
      active,
      pending,
      totalCommissionsUsd: totalCommissions,
    },
    referrals: rows,
  };
}

async function getLeaderboard(userId: string) {
  const commissions = await prisma.commission.groupBy({
    by: ['earnerId'],
    where: { earnerId: userId },
    _sum: { amountUsd: true },
  });

  // Global-style leaderboard scoped to this user's own referral network for now.
  const topReferrals = await prisma.commission.findMany({
    where: { earnerId: userId },
    orderBy: { amountUsd: 'desc' },
    take: 5,
    include: { referral: true },
  });

  return topReferrals.map((c) => ({ commissionUsd: Number(c.amountUsd), referralId: c.referralId }));
}

// ── Controller ───────────────────────────────────────────────────
/**
 * @openapi
 * /referrals:
 *   get:
 *     tags: [Referrals]
 *     summary: Get the current user's referral link, stats, and referred-user tracking table
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Referral overview }
 */
const overviewHandler = catchAsync(async (req: Request, res: Response) => {
  const data = await getReferralOverview(req.user!.id);
  res.json({ success: true, data });
});

/**
 * @openapi
 * /referrals/leaderboard:
 *   get:
 *     tags: [Referrals]
 *     summary: Get the current user's top-performing referrals by commission earned
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Leaderboard }
 */
const leaderboardHandler = catchAsync(async (req: Request, res: Response) => {
  const data = await getLeaderboard(req.user!.id);
  res.json({ success: true, data });
});

// ── Routes ───────────────────────────────────────────────────────
const router = Router();
router.use(requireAuth);
router.get('/', overviewHandler);
router.get('/leaderboard', leaderboardHandler);

export default router;
