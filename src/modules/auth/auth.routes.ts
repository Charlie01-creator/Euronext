import { Router } from 'express';
import { validate } from '../../middleware/validate.middleware';
import { requireAuth } from '../../middleware/auth.middleware';
import { authLimiter } from '../../middleware/rateLimit.middleware';
import {
  forgotPasswordSchema,
  loginSchema,
  refreshSchema,
  registerSchema,
  resetPasswordSchema,
  revokeSessionSchema,
  verifyEmailSchema,
} from './auth.validation';
import {
  forgotPasswordHandler,
  listSessionsHandler,
  loginHandler,
  logoutHandler,
  refreshHandler,
  registerHandler,
  resendVerificationHandler,
  resetPasswordHandler,
  revokeSessionHandler,
  verifyEmailHandler,
} from './auth.controller';

const router = Router();

router.post('/register', authLimiter, validate(registerSchema), registerHandler);
router.post('/login', authLimiter, validate(loginSchema), loginHandler);
router.post('/refresh', authLimiter, validate(refreshSchema), refreshHandler);
router.post('/logout', requireAuth, logoutHandler);
router.post('/forgot-password', authLimiter, validate(forgotPasswordSchema), forgotPasswordHandler);
router.post('/reset-password', authLimiter, validate(resetPasswordSchema), resetPasswordHandler);
router.post('/verify-email', authLimiter, validate(verifyEmailSchema), verifyEmailHandler);
router.post('/resend-verification', requireAuth, authLimiter, resendVerificationHandler);
router.get('/sessions', requireAuth, listSessionsHandler);
router.delete('/sessions/:id', requireAuth, validate(revokeSessionSchema), revokeSessionHandler);

export default router;
