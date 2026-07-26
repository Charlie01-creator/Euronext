import Redis from 'ioredis';
import { env } from '../config/env';
import { logger } from '../config/logger';

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  lazyConnect: false,
});

redis.on('connect', () => logger.info('Redis connected'));
redis.on('error', (err) => logger.error({ err }, 'Redis connection error'));

/** Cache-aside helper: reads JSON from Redis, falls back to the loader, then caches the result. */
export async function cached<T>(key: string, ttlSeconds: number, loader: () => Promise<T>): Promise<T> {
  const hit = await redis.get(key);
  if (hit) return JSON.parse(hit) as T;
  const value = await loader();
  await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  return value;
}

export async function invalidate(pattern: string): Promise<void> {
  const keys = await redis.keys(pattern);
  if (keys.length) await redis.del(...keys);
}
