import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { redis } from '../lib/redis';
import { env } from '../config/env';

// A Redis-backed store means the limit is shared across every instance of this service — with
// the default in-memory store, running N instances behind a load balancer effectively gives an
// attacker N× the allowed attempts, since each instance counts independently.
function redisStore(prefix: string) {
  return new RedisStore({
    prefix,
    sendCommand: (...args: string[]) => redis.call(...args) as Promise<any>,
  });
}

export const generalLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  store: redisStore('rl:general:'),
  message: { success: false, message: 'Too many requests, please slow down.' },
});

/** Tighter limiter for auth and money-movement endpoints, where brute-force/abuse risk is highest. */
export const authLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.AUTH_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  store: redisStore('rl:auth:'),
  message: { success: false, message: 'Too many attempts, please try again shortly.' },
});
