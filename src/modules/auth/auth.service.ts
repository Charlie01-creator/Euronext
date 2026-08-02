import { v4 as uuid } from 'uuid';
import { prisma } from '../../lib/prisma';
import { redis } from '../../lib/redis';
import { ApiError } from '../../utils/ApiError';
import { comparePassword, generateReferralCode, hashPassword } from '../../utils/password';
import {
  hashToken,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../../utils/jwt';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { LoginInput, RegisterInput } from './auth.validation';
import { createNotification } from '../notifications/notifications.service';

const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days — default, mirrors JWT_REFRESH_EXPIRES_IN
const REMEMBER_ME_TTL_SECONDS = 60 * 60 * 24 * 90; // 90 days when rememberMe is set

const MAX_FAILED_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_SECONDS = 60 * 15; // 15 minutes

function publicUser(user: { id: string; fullName: string; email: string; referralCode: string; defaultCurrency: string; kycStatus: string; twoFactorEnabled: boolean; isEmailVerified: boolean; role: string; createdAt: Date }) {
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    referralCode: user.referralCode,
    defaultCurrency: user.defaultCurrency,
    kycStatus: user.kycStatus,
    twoFactorEnabled: user.twoFactorEnabled,
    isEmailVerified: user.isEmailVerified,
    role: user.role,
    memberSince: user.createdAt,
  };
}

async function issueTokenPair(
  userId: string,
  email: string,
  role: 'USER' | 'ADMIN',
  context?: { device?: string; ipAddress?: string; rememberMe?: boolean }
) {
  const accessToken = signAccessToken({ sub: userId, email, role });
  const jti = uuid();
  const ttlSeconds = context?.rememberMe ? REMEMBER_ME_TTL_SECONDS : REFRESH_TOKEN_TTL_SECONDS;
  const refreshToken = signRefreshToken({ sub: userId, jti }, `${ttlSeconds}s`);

  await prisma.refreshToken.create({
    data: {
      id: jti,
      userId,
      tokenHash: hashToken(refreshToken),
      device: context?.device,
      ipAddress: context?.ipAddress,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000),
    },
  });

  return { accessToken, refreshToken };
}

export async function register(input: RegisterInput) {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) throw ApiError.conflict('An account with this email already exists');

  let referredById: string | undefined;
  if (input.referralCode) {
    const referrer = await prisma.user.findUnique({ where: { referralCode: input.referralCode } });
    if (!referrer) throw ApiError.badRequest('Invalid referral code');
    referredById = referrer.id;
  }

  const passwordHash = await hashPassword(input.password);

  let referralCode = generateReferralCode(input.fullName);
  // extremely unlikely to collide, but guard against it anyway
  while (await prisma.user.findUnique({ where: { referralCode } })) {
    referralCode = generateReferralCode(input.fullName);
  }

  const user = await prisma.user.create({
    data: {
      fullName: input.fullName,
      email: input.email,
      phone: input.phone,
      country: input.country ?? 'Uganda',
      passwordHash,
      referralCode,
      referredById,
    },
  });

  if (referredById) {
    await prisma.referral.create({
      data: { referrerId: referredById, referredId: user.id, status: 'PENDING' },
    });
    await createNotification({
      userId: referredById,
      type: 'SYSTEM',
      icon: 'fa-user-plus',
      color: 'blue',
      title: 'New referral joined',
      description: `${user.fullName} signed up using your referral link.`,
    });
  }

  await issueEmailVerificationToken(user.id, user.email);

  const tokens = await issueTokenPair(user.id, user.email, user.role);
  return { user: publicUser(user), ...tokens };
}

/** Accepts +256XXXXXXXXX, 256XXXXXXXXX, 0XXXXXXXXX, or bare 9-digit local formats and normalizes to +256XXXXXXXXX. */
export function normalizeUgandaPhone(raw: string): string {
  const s = raw.replace(/[\s\-()]/g, '');
  if (s.startsWith('+256')) return s;
  if (s.startsWith('256')) return `+${s}`;
  if (s.startsWith('0')) return `+256${s.slice(1)}`;
  if (/^[27]\d{8}$/.test(s)) return `+256${s}`;
  return s;
}

export async function login(
  input: LoginInput,
  context: { ipAddress: string; device: string; rememberMe?: boolean }
) {
  const user = input.email
    ? await prisma.user.findUnique({ where: { email: input.email } })
    : await prisma.user.findUnique({ where: { phone: normalizeUgandaPhone(input.phoneNumber!) } });

  if (!user) throw ApiError.unauthorized('Invalid credentials');

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const minutesLeft = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
    throw ApiError.locked(`Too many failed attempts. Try again in ${minutesLeft} minute(s).`);
  }

  const valid = await comparePassword(input.password, user.passwordHash);
  if (!valid) {
    const attempts = user.failedLoginAttempts + 1;
    const isNowLocked = attempts >= MAX_FAILED_LOGIN_ATTEMPTS;

    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: isNowLocked ? 0 : attempts,
        lockedUntil: isNowLocked ? new Date(Date.now() + LOCKOUT_DURATION_SECONDS * 1000) : null,
      },
    });

    if (isNowLocked) {
      await createNotification({
        userId: user.id,
        type: 'SECURITY',
        icon: 'fa-triangle-exclamation',
        color: 'red',
        title: 'Account temporarily locked',
        description: `${MAX_FAILED_LOGIN_ATTEMPTS} failed login attempts were detected. Your account is locked for 15 minutes.`,
      });
      throw ApiError.locked();
    }

    throw ApiError.unauthorized('Invalid credentials');
  }

  // successful login — clear any accumulated failed-attempt count
  if (user.failedLoginAttempts > 0 || user.lockedUntil) {
    await prisma.user.update({ where: { id: user.id }, data: { failedLoginAttempts: 0, lockedUntil: null } });
  }

  await prisma.loginActivity.create({
    data: {
      userId: user.id,
      device: context.device,
      ipAddress: context.ipAddress,
    },
  });

  const tokens = await issueTokenPair(user.id, user.email, user.role, {
    device: context.device,
    ipAddress: context.ipAddress,
    rememberMe: context.rememberMe,
  });
  return { user: publicUser(user), ...tokens };
}

export async function refresh(refreshToken: string) {
  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw ApiError.unauthorized('Invalid or expired refresh token');
  }

  const tokenHash = hashToken(refreshToken);
  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash } });

  if (!stored || stored.revoked || stored.expiresAt < new Date()) {
    throw ApiError.unauthorized('Refresh token has been revoked or expired');
  }

  // rotate: revoke the old token, issue a brand new pair
  await prisma.refreshToken.update({ where: { id: stored.id }, data: { revoked: true } });

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user) throw ApiError.unauthorized('User no longer exists');

  const tokens = await issueTokenPair(user.id, user.email, user.role);
  return tokens;
}

export async function logout(refreshToken: string | undefined, userId: string) {
  if (refreshToken) {
    const tokenHash = hashToken(refreshToken);
    await prisma.refreshToken.updateMany({ where: { tokenHash }, data: { revoked: true } });
  }
  // also drop any cached session data for this user
  await redis.del(`session:${userId}`);
}

const RESET_TOKEN_TTL_SECONDS = 60 * 30; // 30 minutes

/**
 * Always resolves successfully regardless of whether the phone number matches an account —
 * this is deliberate (anti-enumeration): a caller should not be able to tell which phone
 * numbers have accounts by watching for different responses.
 */
export async function forgotPassword(phoneNumber: string) {
  const normalized = normalizeUgandaPhone(phoneNumber);
  const user = await prisma.user.findUnique({ where: { phone: normalized } });
  if (!user) return; // silently no-op — same response either way

  const token = uuid();
  await redis.set(`password-reset:${token}`, user.id, 'EX', RESET_TOKEN_TTL_SECONDS);

  // This project doesn't yet integrate an SMS/email provider (e.g. Africa's Talking, since
  // this is a Uganda-focused product) to actually deliver the token to the user — that's a
  // real external account/integration dependency, documented in the README alongside the
  // other out-of-scope integrations (Pesapal merchant verification, admin API). Logging it here in the
  // meantime so the flow is fully testable end-to-end in development.
  logger.info({ userId: user.id, token }, 'Password reset token issued — wire up SMS/email delivery before production use');
}

export async function resetPassword(token: string, newPassword: string) {
  const userId = await redis.get(`password-reset:${token}`);
  if (!userId) throw ApiError.badRequest('This reset link is invalid or has expired');

  const passwordHash = await hashPassword(newPassword);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
  await redis.del(`password-reset:${token}`);

  // revoke every existing session — a password reset should log the user out everywhere
  await prisma.refreshToken.updateMany({ where: { userId }, data: { revoked: true } });
}

// ── Email verification ──────────────────────────────────────────
const EMAIL_VERIFY_TTL_SECONDS = 60 * 60 * 24; // 24 hours

async function issueEmailVerificationToken(userId: string, email: string) {
  const token = uuid();
  await redis.set(`email-verify:${token}`, userId, 'EX', EMAIL_VERIFY_TTL_SECONDS);
  // Same external-integration gap as forgot-password: no SMS/email provider wired up yet.
  logger.info({ userId, email, token }, 'Email verification token issued — wire up email delivery before production use');
}

export async function verifyEmail(token: string) {
  const userId = await redis.get(`email-verify:${token}`);
  if (!userId) throw ApiError.badRequest('This verification link is invalid or has expired');

  await prisma.user.update({ where: { id: userId }, data: { isEmailVerified: true } });
  await redis.del(`email-verify:${token}`);
}

export async function resendVerification(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.isEmailVerified) throw ApiError.badRequest('Email is already verified');
  await issueEmailVerificationToken(user.id, user.email);
}

// ── Session management (multi-device) ───────────────────────────
export async function listSessions(userId: string, currentRefreshToken: string | undefined) {
  const currentTokenHash = currentRefreshToken ? hashToken(currentRefreshToken) : null;

  const sessions = await prisma.refreshToken.findMany({
    where: { userId, revoked: false, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, device: true, ipAddress: true, createdAt: true, expiresAt: true, tokenHash: true },
  });

  return sessions.map((s) => ({
    id: s.id,
    device: s.device ?? 'Unknown device',
    ipAddress: s.ipAddress ?? 'Unknown',
    createdAt: s.createdAt,
    expiresAt: s.expiresAt,
    isCurrent: s.tokenHash === currentTokenHash,
  }));
}

/** Revokes one specific session (device) by RefreshToken id, scoped to the requesting user so one user can't revoke another's session. */
export async function revokeSession(userId: string, sessionId: string) {
  const result = await prisma.refreshToken.updateMany({
    where: { id: sessionId, userId },
    data: { revoked: true },
  });
  if (result.count === 0) throw ApiError.notFound('Session not found');
}
