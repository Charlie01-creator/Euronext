import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const PACKAGES = [
  { name: 'Starter', icon: 'fa-seedling', color: '#94A3B8', minAmountUsd: 7, termDays: 15, ratePercent: 1.8, featured: false, sortOrder: 1 },
  { name: 'Basic', icon: 'fa-seedling', color: '#06B6D4', minAmountUsd: 25, termDays: 15, ratePercent: 2.1, featured: false, sortOrder: 2 },
  { name: 'Bronze', icon: 'fa-award', color: '#D97706', minAmountUsd: 50, termDays: 30, ratePercent: 3.4, featured: false, sortOrder: 3 },
  { name: 'Bronze Plus', icon: 'fa-award', color: '#D97706', minAmountUsd: 100, termDays: 30, ratePercent: 3.9, featured: false, sortOrder: 4 },
  { name: 'Silver', icon: 'fa-medal', color: '#94A3B8', minAmountUsd: 250, termDays: 60, ratePercent: 6.2, featured: false, sortOrder: 5 },
  { name: 'Silver Plus', icon: 'fa-medal', color: '#94A3B8', minAmountUsd: 500, termDays: 60, ratePercent: 6.8, featured: false, sortOrder: 6 },
  { name: 'Gold', icon: 'fa-medal', color: '#F59E0B', minAmountUsd: 1000, termDays: 90, ratePercent: 8.5, featured: false, sortOrder: 7 },
  { name: 'Gold Plus', icon: 'fa-medal', color: '#F59E0B', minAmountUsd: 2500, termDays: 90, ratePercent: 9.4, featured: true, sortOrder: 8 },
  { name: 'Platinum', icon: 'fa-gem', color: '#3B82F6', minAmountUsd: 5000, termDays: 180, ratePercent: 11.6, featured: false, sortOrder: 9 },
  { name: 'Platinum Plus', icon: 'fa-gem', color: '#3B82F6', minAmountUsd: 10000, termDays: 180, ratePercent: 12.5, featured: false, sortOrder: 10 },
  { name: 'Diamond', icon: 'fa-gem', color: '#8B5CF6', minAmountUsd: 20000, termDays: 270, ratePercent: 14.2, featured: false, sortOrder: 11 },
  { name: 'Diamond Plus', icon: 'fa-gem', color: '#8B5CF6', minAmountUsd: 35000, termDays: 270, ratePercent: 15.4, featured: false, sortOrder: 12 },
  { name: 'Elite', icon: 'fa-crown', color: '#F59E0B', minAmountUsd: 50000, termDays: 365, ratePercent: 17.8, featured: false, sortOrder: 13 },
  { name: 'Elite Plus', icon: 'fa-crown', color: '#F59E0B', minAmountUsd: 75000, termDays: 365, ratePercent: 19.1, featured: false, sortOrder: 14 },
  { name: 'Institutional', icon: 'fa-building-columns', color: '#10B981', minAmountUsd: 100000, termDays: 365, ratePercent: 21.5, featured: false, sortOrder: 15 },
];

const CURRENCIES = [
  { code: 'USD', symbol: '$', rateToUsd: 1 },
  { code: 'GBP', symbol: '£', rateToUsd: 0.79 },
  { code: 'EUR', symbol: '€', rateToUsd: 0.92 },
  { code: 'UGX', symbol: 'USh ', rateToUsd: 3700 },
  { code: 'CAD', symbol: 'C$', rateToUsd: 1.36 },
  { code: 'AUD', symbol: 'A$', rateToUsd: 1.52 },
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
