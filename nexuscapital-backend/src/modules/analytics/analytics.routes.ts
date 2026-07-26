import { Router, Request, Response } from 'express';
import { requireAuth } from '../../middleware/auth.middleware';
import { catchAsync } from '../../utils/catchAsync';
import * as analyticsService from './analytics.service';

/**
 * @openapi
 * /analytics/dashboard:
 *   get:
 *     tags: [Analytics]
 *     summary: Dashboard overview — portfolio value, streak, active package maturity
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Dashboard overview }
 */
const dashboardHandler = catchAsync(async (req: Request, res: Response) => {
  const data = await analyticsService.getDashboardOverview(req.user!.id);
  res.json({ success: true, data });
});

/**
 * @openapi
 * /analytics/earnings:
 *   get:
 *     tags: [Analytics]
 *     summary: Earnings breakdown — today / week / month / lifetime, package vs referral split
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Earnings breakdown }
 */
const earningsHandler = catchAsync(async (req: Request, res: Response) => {
  const data = await analyticsService.getEarnings(req.user!.id);
  res.json({ success: true, data });
});

/**
 * @openapi
 * /analytics/performance:
 *   get:
 *     tags: [Analytics]
 *     summary: Performance metrics — referral conversion rate, login activity
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Performance metrics }
 */
const performanceHandler = catchAsync(async (req: Request, res: Response) => {
  const data = await analyticsService.getPerformance(req.user!.id);
  res.json({ success: true, data });
});

const router = Router();
router.use(requireAuth);
router.get('/dashboard', dashboardHandler);
router.get('/earnings', earningsHandler);
router.get('/performance', performanceHandler);

export default router;
