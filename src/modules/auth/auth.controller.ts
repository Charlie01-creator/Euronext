import { Request, Response } from 'express';
import { catchAsync } from '../../utils/catchAsync';
import { ApiError } from '../../utils/ApiError';
import * as authService from './auth.service';
import { isProd } from '../../config/env';
import { CSRF_COOKIE, setCsrfCookie } from '../../middleware/csrf.middleware';

const REFRESH_COOKIE = 'nexus_refresh_token';
const DEFAULT_COOKIE_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
const REMEMBER_ME_COOKIE_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 90; // 90 days

function setRefreshCookie(res: Response, token: string, rememberMe?: boolean) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    maxAge: rememberMe ? REMEMBER_ME_COOKIE_MAX_AGE_MS : DEFAULT_COOKIE_MAX_AGE_MS,
    path: '/api/v1/auth',
  });
}

/**
 * @openapi
 * /auth/register:
 *   post:
 *     tags: [Auth]
 *     summary: Create a new account
 *     requestBody:
 *       required: true
 *     responses:
 *       201: { description: Account created }
 */
export const registerHandler = catchAsync(async (req: Request, res: Response) => {
  const result = await authService.register(req.body);
  setRefreshCookie(res, result.refreshToken);
  setCsrfCookie(res);
  res.status(201).json({ success: true, data: { user: result.user, accessToken: result.accessToken } });
});

/**
 * @openapi
 * /auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Authenticate and receive an access token
 *     responses:
 *       200: { description: Authenticated }
 */
export const loginHandler = catchAsync(async (req: Request, res: Response) => {
  const device = req.headers['user-agent'] ?? 'Unknown device';
  const ipAddress = req.ip ?? 'unknown';
  const result = await authService.login(req.body, { device, ipAddress, rememberMe: req.body.rememberMe });
  setRefreshCookie(res, result.refreshToken, req.body.rememberMe);
  setCsrfCookie(res);
  res.status(200).json({ success: true, data: { user: result.user, accessToken: result.accessToken } });
});

/**
 * @openapi
 * /auth/refresh:
 *   post:
 *     tags: [Auth]
 *     summary: Exchange a refresh token for a new access/refresh token pair
 *     responses:
 *       200: { description: Rotated tokens issued }
 */
export const refreshHandler = catchAsync(async (req: Request, res: Response) => {
  const token = req.body.refreshToken ?? req.cookies?.[REFRESH_COOKIE];
  if (!token) throw ApiError.unauthorized('No refresh token provided');

  const tokens = await authService.refresh(token);
  setRefreshCookie(res, tokens.refreshToken);
  setCsrfCookie(res);
  res.status(200).json({ success: true, data: { accessToken: tokens.accessToken } });
});

/**
 * @openapi
 * /auth/logout:
 *   post:
 *     tags: [Auth]
 *     summary: Revoke the current refresh token
 *     responses:
 *       204: { description: Logged out }
 */
export const logoutHandler = catchAsync(async (req: Request, res: Response) => {
  const token = req.body.refreshToken ?? req.cookies?.[REFRESH_COOKIE];
  await authService.logout(token, req.user!.id);
  res.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
  res.clearCookie(CSRF_COOKIE, { path: '/api/v1/auth' });
  res.status(204).send();
});

/**
 * @openapi
 * /auth/forgot-password:
 *   post:
 *     tags: [Auth]
 *     summary: Request a password reset link via the registered phone number
 *     description: Always responds 204 regardless of whether the phone number matches an account (anti-enumeration).
 *     responses:
 *       204: { description: Request accepted }
 */
export const forgotPasswordHandler = catchAsync(async (req: Request, res: Response) => {
  await authService.forgotPassword(req.body.phoneNumber);
  res.status(204).send();
});

/**
 * @openapi
 * /auth/reset-password:
 *   post:
 *     tags: [Auth]
 *     summary: Reset a password using a token issued by /auth/forgot-password
 *     responses:
 *       204: { description: Password updated, all sessions revoked }
 */
export const resetPasswordHandler = catchAsync(async (req: Request, res: Response) => {
  await authService.resetPassword(req.body.token, req.body.password);
  res.status(204).send();
});

/**
 * @openapi
 * /auth/verify-email:
 *   post:
 *     tags: [Auth]
 *     summary: Confirm an email address using the token issued at registration
 *     responses:
 *       204: { description: Email verified }
 */
export const verifyEmailHandler = catchAsync(async (req: Request, res: Response) => {
  await authService.verifyEmail(req.body.token);
  res.status(204).send();
});

/**
 * @openapi
 * /auth/resend-verification:
 *   post:
 *     tags: [Auth]
 *     summary: Issue a fresh email verification token
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       204: { description: A new verification token was issued }
 */
export const resendVerificationHandler = catchAsync(async (req: Request, res: Response) => {
  await authService.resendVerification(req.user!.id);
  res.status(204).send();
});

/**
 * @openapi
 * /auth/sessions:
 *   get:
 *     tags: [Auth]
 *     summary: List every active (non-revoked, unexpired) session/device for the current user
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Active sessions, with the one used for this request flagged isCurrent }
 */
export const listSessionsHandler = catchAsync(async (req: Request, res: Response) => {
  const currentToken = req.cookies?.[REFRESH_COOKIE];
  const sessions = await authService.listSessions(req.user!.id, currentToken);
  res.json({ success: true, data: sessions });
});

/**
 * @openapi
 * /auth/sessions/{id}:
 *   delete:
 *     tags: [Auth]
 *     summary: Revoke one specific session/device (e.g. "log out my old phone")
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       204: { description: Session revoked }
 */
export const revokeSessionHandler = catchAsync(async (req: Request, res: Response) => {
  await authService.revokeSession(req.user!.id, req.params.id);
  res.status(204).send();
});
