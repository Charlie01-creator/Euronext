import { randomBytes } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { ApiError } from '../utils/ApiError';
import { isProd } from '../config/env';

export const CSRF_COOKIE = 'nexus_csrf_token';
const CSRF_HEADER = 'x-csrf-token';

/**
 * Double-submit cookie CSRF protection. Only the endpoints that rely purely on a cookie for
 * authentication (/auth/refresh, /auth/logout) need this — every other money-movement endpoint
 * requires an explicit `Authorization: Bearer` header, which a cross-site form or script can't
 * attach automatically, so those are not vulnerable to classic CSRF the same way.
 *
 * How it works: setCsrfCookie() issues a random token in a cookie the browser JS *can* read
 * (unlike the httpOnly refresh cookie). A legitimate same-origin request reads that cookie and
 * echoes it back as a header. A forged cross-site request can have the browser attach the cookie
 * automatically, but has no way to read its value to also set the matching header — so the two
 * won't match.
 */
export function setCsrfCookie(res: Response): string {
  const token = randomBytes(24).toString('hex');
  res.cookie(CSRF_COOKIE, token, {
    httpOnly: false, // must be readable by frontend JS — this is the point of the pattern
    secure: isProd,
    sameSite: 'lax',
    path: '/api/v1/auth',
  });
  return token;
}

export function requireCsrfToken(req: Request, _res: Response, next: NextFunction) {
  const cookieToken = req.cookies?.[CSRF_COOKIE];
  const headerToken = req.headers[CSRF_HEADER];

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    throw ApiError.forbidden('Missing or invalid CSRF token');
  }
  next();
}
