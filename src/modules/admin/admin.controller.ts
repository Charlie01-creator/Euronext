import { Request, Response } from 'express';
import { catchAsync } from '../../utils/catchAsync';
import * as adminService from './admin.service';

/**
 * @openapi
 * /admin/withdrawals:
 *   get:
 *     tags: [Admin]
 *     summary: List every withdrawal awaiting review, oldest first
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Pending withdrawals with requesting-user details }
 *       403: { description: Not an admin }
 */
export const listPendingWithdrawalsHandler = catchAsync(async (_req: Request, res: Response) => {
  const withdrawals = await adminService.listPendingWithdrawals();
  res.json({ success: true, data: withdrawals });
});

/**
 * @openapi
 * /admin/withdrawals/{id}/approve:
 *   post:
 *     tags: [Admin]
 *     summary: Confirm a withdrawal has been paid out manually — does not send money itself, just records that the admin already has
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Withdrawal marked completed }
 */
export const approveWithdrawalHandler = catchAsync(async (req: Request, res: Response) => {
  const result = await adminService.approveWithdrawal(req.params.id, req.user!.id);
  res.json({ success: true, data: result });
});

/**
 * @openapi
 * /admin/withdrawals/{id}/reject:
 *   post:
 *     tags: [Admin]
 *     summary: Reject a withdrawal and refund the reserved balance to the user
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Withdrawal rejected and refunded }
 */
export const rejectWithdrawalHandler = catchAsync(async (req: Request, res: Response) => {
  const result = await adminService.rejectWithdrawal(req.params.id, req.body?.reason);
  res.json({ success: true, data: result });
});
