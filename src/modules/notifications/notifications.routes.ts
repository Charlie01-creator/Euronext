import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware';
import { listHandler, markAllReadHandler, markOneReadHandler } from './notifications.controller';

const router = Router();

router.use(requireAuth);
router.get('/', listHandler);
router.patch('/read-all', markAllReadHandler);
router.patch('/:id/read', markOneReadHandler);

export default router;
