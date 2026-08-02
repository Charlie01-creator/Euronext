import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.middleware';
import { validate } from '../../middleware/validate.middleware';
import { rejectWithdrawalSchema, withdrawalIdSchema } from './admin.validation';
import {
  approveWithdrawalHandler,
  listPendingWithdrawalsHandler,
  rejectWithdrawalHandler,
} from './admin.controller';

const router = Router();

router.use(requireAuth, requireRole('ADMIN'));

router.get('/withdrawals', listPendingWithdrawalsHandler);
router.post('/withdrawals/:id/approve', validate(withdrawalIdSchema), approveWithdrawalHandler);
router.post('/withdrawals/:id/reject', validate(rejectWithdrawalSchema), rejectWithdrawalHandler);

export default router;
