import { Request, Response } from 'express';
import { catchAsync } from '../../utils/catchAsync';
import { parsePagination, paginatedResponse } from '../../utils/pagination';
import * as notificationsService from './notifications.service';

/**
 * @openapi
 * /notifications:
 *   get:
 *     tags: [Notifications]
 *     summary: List the current user's notifications (most recent first), paginated
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, default: 20, maximum: 100 } }
 *     responses:
 *       200: { description: Paginated notification list with unread count }
 */
export const listHandler = catchAsync(async (req: Request, res: Response) => {
  const pagination = parsePagination(req.query);
  const [items, total, unread] = await Promise.all([
    notificationsService.listNotifications(req.user!.id, pagination),
    notificationsService.countNotifications(req.user!.id),
    notificationsService.unreadCount(req.user!.id),
  ]);
  res.json({ success: true, data: { ...paginatedResponse(items, total, pagination), unreadCount: unread } });
});

/**
 * @openapi
 * /notifications/{id}/read:
 *   patch:
 *     tags: [Notifications]
 *     summary: Mark a single notification as read
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       204: { description: Marked read }
 */
export const markOneReadHandler = catchAsync(async (req: Request, res: Response) => {
  await notificationsService.markOneRead(req.user!.id, req.params.id);
  res.status(204).send();
});

/**
 * @openapi
 * /notifications/read-all:
 *   patch:
 *     tags: [Notifications]
 *     summary: Mark every notification as read
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       204: { description: All marked read }
 */
export const markAllReadHandler = catchAsync(async (req: Request, res: Response) => {
  await notificationsService.markAllRead(req.user!.id);
  res.status(204).send();
});
