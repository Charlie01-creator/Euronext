import { NextFunction, Request, Response } from 'express';
import { redis } from '../lib/redis';
import { ApiError } from '../utils/ApiError';
import { catchAsync } from '../utils/catchAsync';

const IDEMPOTENCY_TTL_SECONDS = 60 * 10; // 10 minutes

/**
 * Requires an `Idempotency-Key` header on money-movement requests (deposits, withdrawals,
 * package purchases). If the same key is replayed while a prior attempt is still in flight or
 * already succeeded, the request is rejected with 409 instead of silently double-processing.
 *
 * Success and failure are handled differently on purpose:
 *  - On success (2xx), the key stays reserved for the full TTL — a replay of a *successful*
 *    request must not be allowed to submit again.
 *  - On failure (4xx/5xx), the key is released immediately. The original implementation kept the
 *    key locked either way, which meant a transient failure (a Flutterwave timeout, a validation
 *    error) permanently burned that key for 10 minutes — the client's legitimate retry got a
 *    false "already submitted" response even though nothing had actually succeeded.
 */
export const requireIdempotencyKey = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const key = req.headers['idempotency-key'];
  if (!key || typeof key !== 'string') {
    throw ApiError.badRequest('Idempotency-Key header is required for this operation');
  }

  const redisKey = `idempotency:${req.user?.id ?? 'anon'}:${key}`;
  const wasSet = await redis.set(redisKey, 'in-progress', 'EX', IDEMPOTENCY_TTL_SECONDS, 'NX');

  if (wasSet === null) {
    throw ApiError.conflict('This request has already been submitted. Please wait before retrying.');
  }

  res.on('finish', () => {
    if (res.statusCode >= 400) {
      // fire-and-forget: releasing the key is best-effort cleanup, not something worth blocking
      // the response on or retrying — worst case it just sits until the TTL expires naturally.
      redis.del(redisKey).catch(() => undefined);
    }
  });

  next();
});
