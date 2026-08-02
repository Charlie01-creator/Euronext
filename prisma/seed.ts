import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const PACKAGES = [
  { name: 'Starter', icon: 'fa-seedling', color: '#94A3B8', minAmountUsd: 7, termDays: 15, fixedReturnUsd: 0.14, featured: false, sortOrder: 1 },
  { name: 'Basic', icon: 'fa-seedling', color: '#06B6D4', minAmountUsd: 25, termDays: 15, fixedReturnUsd: 0.53, featured: false, sortOrder: 2 },
  { name: 'Bronze', icon: 'fa-award', color: '#D97706', minAmountUsd: 50, termDays: 30, fixedReturnUsd: 1.75, featured: false, sortOrder: 3 },
  { name: 'Bronze Plus', icon: 'fa-award', color: '#D97706', minAmountUsd: 100, termDays: 30, fixedReturnUsd: 3.90, featured: false, sortOrder: 4 },
  { name: 'Silver', icon: 'fa-medal', color: '#94A3B8', minAmountUsd: 250, termDays: 60, fixedReturnUsd: 15.50, featured: false, sortOrder: 5 },
  { name: 'Silver Plus', icon: 'fa-medal', color: '#94A3B8', minAmountUsd: 500, termDays: 60, fixedReturnUsd: 34.00, featured: false, sortOrder: 6 },
  { name: 'Gold', icon: 'fa-medal', color: '#F59E0B', minAmountUsd: 1000, termDays: 90, fixedReturnUsd: 85.00, featured: false, sortOrder: 7 },
  { name: 'Gold Plus', icon: 'fa-medal', color: '#F59E0B', minAmountUsd: 2500, termDays: 90, fixedReturnUsd: 235.00, featured: true, sortOrder: 8 },
  { name: 'Platinum', icon: 'fa-gem', color: '#3B82F6', minAmountUsd: 5000, termDays: 180, fixedReturnUsd: 580.00, featured: false, sortOrder: 9 },
  { name: 'Platinum Plus', icon: 'fa-gem', color: '#3B82F6', minAmountUsd: 10000, termDays: 180, fixedReturnUsd: 1250.00, featured: false, sortOrder: 10 },
  { name: 'Diamond', icon: 'fa-gem', color: '#8B5CF6', minAmountUsd: 20000, termDays: 270, fixedReturnUsd: 2840.00, featured: false, sortOrder: 11 },
  { name: 'Diamond Plus', icon: 'fa-gem', color: '#8B5CF6', minAmountUsd: 35000, termDays: 270, fixedReturnUsd: 5390.00, featured: false, sortOrder: 12 },
  { name: 'Elite', icon: 'fa-crown', color: '#F59E0B', minAmountUsd: 50000, termDays: 365, fixedReturnUsd: 8900.00, featured: false, sortOrder: 13 },
  { name: 'Elite Plus', icon: 'fa-crown', color: '#F59E0B', minAmountUsd: 75000, termDays: 365, fixedReturnUsd: 14325.00, featured: false, sortOrder: 14 },
  { name: 'Institutional', icon: 'fa-building-columns', color: '#10B981', minAmountUsd: 100000, termDays: 365, fixedReturnUsd: 21500.00, featured: false, sortOrder: 15 },
];

const CURRENCIES = [
  { code: 'USD', symbol: '$', rateToUsd: 1 }, // internal ledger reference — every amount is stored in USD; not shown as a selectable option in the frontend
  { code: 'UGX', symbol: 'USh ', rateToUsd: 3700 },
  { code: 'KES', symbol: 'KSh ', rateToUsd: 129.5 },
  { code: 'TZS', symbol: 'TSh ', rateToUsd: 2630 },
];

async function main() {
  console.log('Seeding packages…');
  for (const pkg of PACKAGES) {
    await prisma.package.upsert({
      where: { name: pkg.name },
      update: pkg,
      create: pkg,
    });
  }

  console.log('Seeding currency rates…');
  for (const cur of CURRENCIES) {
    await prisma.currencyRate.upsert({
      where: { code: cur.code },
      update: { symbol: cur.symbol, rateToUsd: cur.rateToUsd },
      create: cur,
    });
  }

  // Remove any currency that was seeded previously but is no longer in the list above —
  // an upsert loop alone only adds/updates, it never deletes, so a database seeded before this
  // list was reduced would otherwise keep GBP/EUR/CAD/AUD sitting around as orphaned rows.
  const activeCodes = CURRENCIES.map((c) => c.code);
  const removed = await prisma.currencyRate.deleteMany({ where: { code: { notIn: activeCodes } } });
  if (removed.count > 0) {
    console.log(`Removed ${removed.count} currency/currencies no longer in use.`);
  }

  // Promote a specific account to ADMIN, if configured. This is the only way to reach the new
  // admin endpoints (approve/reject withdrawals) — there is deliberately no self-service "become
  // admin" API route, since that would be a serious privilege-escalation risk. Set ADMIN_EMAIL in
  // .env to the email of an account that already exists (register it first, then re-run the seed).
  if (process.env.ADMIN_EMAIL) {
    const admin = await prisma.user.updateMany({
      where: { email: process.env.ADMIN_EMAIL },
      data: { role: 'ADMIN' },
    });
    if (admin.count > 0) {
      console.log(`Promoted ${process.env.ADMIN_EMAIL} to ADMIN.`);
    } else {
      console.warn(`ADMIN_EMAIL was set to ${process.env.ADMIN_EMAIL}, but no account with that email exists yet — register it first, then re-run the seed.`);
    }
  }

  console.log('Seed complete.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
