import { Request, Response } from 'express';
import { catchAsync } from '../../utils/catchAsync';
import * as packagesService from './packages.service';

/**
 * @openapi
 * /packages:
 *   get:
 *     tags: [Packages]
 *     summary: List the full 15-tier investment package catalog
 *     responses:
 *       200: { description: Package catalog }
 */
export const catalogHandler = catchAsync(async (_req: Request, res: Response) => {
  const packages = await packagesService.listCatalog();
  res.json({ success: true, data: packages });
});

/**
 * @openapi
 * /packages/active:
 *   get:
 *     tags: [Packages]
 *     summary: Get the current user's active investment package
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Active package, or null if none }
 */
export const activeHandler = catchAsync(async (req: Request, res: Response) => {
  const active = await packagesService.getActivePackage(req.user!.id);
  res.json({ success: true, data: active });
});

/**
 * @openapi
 * /packages/history:
 *   get:
 *     tags: [Packages]
 *     summary: Get the current user's matured/cancelled packages
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Package history }
 */
export const historyHandler = catchAsync(async (req: Request, res: Response) => {
  const history = await packagesService.getHistory(req.user!.id);
  res.json({ success: true, data: history });
});

/**
 * @openapi
 * /packages/{id}/purchase:
 *   post:
 *     tags: [Packages]
 *     summary: Purchase an investment package via MTN, Airtel, Card, or Bank Transfer
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: header, name: Idempotency-Key, required: true, schema: { type: string } }
 *     responses:
 *       201: { description: Purchase initiated — check redirectUrl for card/bank, or wait for the mobile money prompt }
 */
export const purchaseHandler = catchAsync(async (req: Request, res: Response) => {
  const result = await packagesService.purchasePackage(req.user!.id, req.params.id, req.body);
  res.status(201).json({ success: true, data: result });
});
