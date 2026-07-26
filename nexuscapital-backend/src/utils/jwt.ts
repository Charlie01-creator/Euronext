import jwt, { SignOptions } from 'jsonwebtoken';
import crypto from 'crypto';
import { env } from '../config/env';

export interface AccessTokenPayload {
  sub: string; // userId
  email: string;
  role: 'USER' | 'ADMIN';
}

export interface RefreshTokenPayload {
  sub: string;
  jti: string; // unique token id, used to look up/revoke in DB
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRES_IN,
    algorithm: 'HS256',
  } as SignOptions);
}

export function signRefreshToken(payload: RefreshTokenPayload, expiresIn?: string): string {
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, {
    expiresIn: expiresIn ?? env.JWT_REFRESH_EXPIRES_IN,
    algorithm: 'HS256',
  } as SignOptions);
}

function isAccessTokenPayload(payload: unknown): payload is AccessTokenPayload {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    typeof (payload as Record<string, unknown>).sub === 'string' &&
    typeof (payload as Record<string, unknown>).email === 'string' &&
    typeof (payload as Record<string, unknown>).role === 'string'
  );
}

function isRefreshTokenPayload(payload: unknown): payload is RefreshTokenPayload {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    typeof (payload as Record<string, unknown>).sub === 'string' &&
    typeof (payload as Record<string, unknown>).jti === 'string'
  );
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  // algorithms: pins verification to HS256 only — without this, jwt.verify trusts whatever
  // algorithm the token header claims, which is the classic "algorithm confusion" attack surface.
  const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'] });
  if (!isAccessTokenPayload(payload)) {
    throw new Error('Malformed access token payload');
  }
  return payload;
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  const payload = jwt.verify(token, env.JWT_REFRESH_SECRET, { algorithms: ['HS256'] });
  if (!isRefreshTokenPayload(payload)) {
    throw new Error('Malformed refresh token payload');
  }
  return payload;
}

/** Refresh tokens are stored hashed (never in plaintext) so a DB leak doesn't leak usable tokens. */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
