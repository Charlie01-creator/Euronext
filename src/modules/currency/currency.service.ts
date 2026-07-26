import { prisma } from '../../lib/prisma';
import { cached, invalidate } from '../../lib/redis';
import { ApiError } from '../../utils/ApiError';
import { roundMoney } from '../../utils/money';

const CACHE_KEY = 'currency:rates';
const CACHE_TTL_SECONDS = 60 * 60; // 1 hour — rates change rarely, no need to hit Postgres every request

export async function getRates() {
  return cached(CACHE_KEY, CACHE_TTL_SECONDS, async () => {
    const rows = await prisma.currencyRate.findMany();
    return rows.map((r) => ({ code: r.code, symbol: r.symbol, rate: Number(r.rateToUsd) }));
  });
}

export async function refreshRatesCache() {
  await invalidate(CACHE_KEY);
}

/** Converts a user-submitted amount (in `currencyCode`) into the USD value stored in the ledger. */
export async function toUsd(amount: number, currencyCode: string): Promise<number> {
  const rates = await getRates();
  const rate = rates.find((r) => r.code === currencyCode);
  if (!rate) throw ApiError.badRequest(`Unsupported currency: ${currencyCode}`);
  return roundMoney(amount / rate.rate);
}

/** Converts a USD ledger value into the given display currency. */
export async function fromUsd(usdAmount: number, currencyCode: string): Promise<number> {
  const rates = await getRates();
  const rate = rates.find((r) => r.code === currencyCode);
  if (!rate) throw ApiError.badRequest(`Unsupported currency: ${currencyCode}`);
  return roundMoney(usdAmount * rate.rate);
}
