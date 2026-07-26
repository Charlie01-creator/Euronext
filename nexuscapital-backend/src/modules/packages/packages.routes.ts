import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware';
import { validate } from '../../middleware/validate.middleware';
import { requireIdempotencyKey } from '../../middleware/idempotency.middleware';
import { purchasePackageSchema } from './packages.validation';
import { activeHandler, catalogHandler, historyHandler, purchaseHandler } from './packages.controller';

const router = Router();

router.get('/', catalogHandler);
router.get('/active', requireAuth, activeHandler);
router.get('/history', requireAuth, historyHandler);
router.post(
  '/:id/purchase',
  requireAuth,
  requireIdempotencyKey,
  validate(purchasePackageSchema),
  purchaseHandler
);

export default router;
