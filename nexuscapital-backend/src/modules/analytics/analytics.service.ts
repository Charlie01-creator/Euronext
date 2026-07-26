import { prisma } from '../../lib/prisma';

export async function getDashboardOverview(userId: string) {
  const [user, activePackage, loginDays] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId } }),
    prisma.userPackage.findFirst({ where: { userId, status: 'ACTIVE' }, include: { package: true } }),
    prisma.loginActivity.findMany({ where: { userId }, select: { createdAt: true }, orderBy: { createdAt: 'desc' } }),
  ]);

  const distinctDays = new Set(loginDays.map((l) => l.createdAt.toISOString().slice(0, 10)));
  const activeDays = distinctDays.size;
  const streak = computeStreak(Array.from(distinctDays));

  let maturityPercent = 0;
  let daysRemaining = 0;
  if (activePackage) {
    const totalMs = activePackage.maturesAt.getTime() - activePackage.startedAt.getTime();
    const elapsedMs = Date.now() - activePackage.startedAt.getTime();
    maturityPercent = totalMs > 0 ? Math.min(100, Math.max(0, Math.round((elapsedMs / totalMs) * 100))) : 0;
    daysRemaining = Math.max(0, Math.ceil((activePackage.maturesAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
  }

  const portfolioValueUsd = Number(user.balanceUsd) + (activePackage ? Number(activePackage.principalUsd) : 0);

  return {
    fullName: user.fullName,
    memberSince: user.createdAt,
    kycStatus: user.kycStatus,
    portfolioValueUsd,
    activeDays,
    streak,
    activePackage: activePackage
      ? {
          name: activePackage.package.name,
          maturityPercent,
          daysRemaining,
          maturesAt: activePackage.maturesAt,
          projectedReturnUsd: Number(activePackage.projectedReturnUsd),
        }
      : null,
  };
}

function computeStreak(isoDates: string[]): number {
  if (isoDates.length === 0) return 0;
  const sorted = [...isoDates].sort().reverse();
  let streak = 1;
  let cursor = new Date(sorted[0]);

  for (let i = 1; i < sorted.length; i++) {
    const expected = new Date(cursor);
    expected.setDate(expected.getDate() - 1);
    const actual = new Date(sorted[i]);
    if (expected.toISOString().slice(0, 10) === actual.toISOString().slice(0, 10)) {
      streak++;
      cursor = actual;
    } else {
      break;
    }
  }
  return streak;
}

export async function getEarnings(userId: string) {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfWeek = new Date(startOfDay);
  startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const earningTypes = ['PACKAGE_RETURN', 'COMMISSION'] as const;

  const [today, week, month, lifetime, breakdown] = await Promise.all([
    sumEarnings(userId, startOfDay),
    sumEarnings(userId, startOfWeek),
    sumEarnings(userId, startOfMonth),
    sumEarnings(userId, new Date(0)),
    prisma.transaction.groupBy({
      by: ['type'],
      where: { userId, type: { in: [...earningTypes] }, status: 'COMPLETED' },
      _sum: { amountUsd: true },
    }),
  ]);

  const packageEarnings = Number(breakdown.find((b) => b.type === 'PACKAGE_RETURN')?._sum.amountUsd ?? 0);
  const referralEarnings = Number(breakdown.find((b) => b.type === 'COMMISSION')?._sum.amountUsd ?? 0);

  return {
    today,
    week,
    month,
    lifetime,
    breakdown: { packageEarnings, referralEarnings },
  };
}

async function sumEarnings(userId: string, since: Date): Promise<number> {
  const result = await prisma.transaction.aggregate({
    where: {
      userId,
      status: 'COMPLETED',
      type: { in: ['PACKAGE_RETURN', 'COMMISSION'] },
      createdAt: { gte: since },
    },
    _sum: { amountUsd: true },
  });
  return Number(result._sum.amountUsd ?? 0);
}

export async function getPerformance(userId: string) {
  const [totalReferrals, qualifiedReferrals, loginCount] = await Promise.all([
    prisma.referral.count({ where: { referrerId: userId } }),
    prisma.referral.count({ where: { referrerId: userId, status: { in: ['QUALIFIED', 'PAID'] } } }),
    prisma.loginActivity.count({ where: { userId } }),
  ]);

  const conversionRate = totalReferrals > 0 ? Math.round((qualifiedReferrals / totalReferrals) * 100) : 0;

  return {
    referralConversionRatePercent: conversionRate,
    totalLogins: loginCount,
  };
}
