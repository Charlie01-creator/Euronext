import { NextFunction, Request, Response } from 'express';
import { ApiError } from '../utils/ApiError';
import { verifyAccessToken } from '../utils/jwt';
import { catchAsync } from '../utils/catchAsync';

/** Requires a valid access token in the Authorization header; attaches req.user. */
export const requireAuth = catchAsync(async (req: Request, _res: Response, next: NextFunction) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw ApiError.unauthorized('Missing or malformed Authorization header');
  }

  const token = header.slice('Bearer '.length);

  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub, email: payload.email, role: payload.role };
    next();
  } catch {
    throw ApiError.unauthorized('Invalid or expired access token');
  }
});

/** Attaches req.user if a valid token is present, but never rejects the request. */
export const optionalAuth = (req: Request, _res: Response, next: NextFunction) => {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    try {
      const payload = verifyAccessToken(header.slice('Bearer '.length));
      req.user = { id: payload.sub, email: payload.email, role: payload.role };
    } catch {
      // ignore invalid token in optional contexts
    }
  }
  next();
};

/**
 * RBAC gate — use after requireAuth. Role lives in the access token, not looked up from the DB
 * on every request, which is why access tokens are kept short-lived: a role change takes effect
 * as soon as the user's current access token expires (minutes), not immediately, which is the
 * standard tradeoff for JWT-embedded claims versus a DB round-trip on every single request.
 *
 * Example: router.get('/admin/users', requireAuth, requireRole('ADMIN'), handler)
 */
export const requireRole =
  (...allowedRoles: Array<'USER' | 'ADMIN'>) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw ApiError.unauthorized('Authentication required');
    if (!allowedRoles.includes(req.user.role)) {
      throw ApiError.forbidden('You do not have permission to perform this action');
    }
    next();
  };
