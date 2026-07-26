import { Request, Response } from 'express';
import { Router } from 'express';
import { catchAsync } from '../../utils/catchAsync';
import * as currencyService from './currency.service';

/**
 * @openapi
 * /currency/rates:
 *   get:
 *     tags: [Currency]
 *     summary: Get every supported currency and its USD conversion rate
 *     responses:
 *       200: { description: Currency rate list }
 */
const ratesHandler = catchAsync(async (_req: Request, res: Response) => {
  const rates = await currencyService.getRates();
  res.json({ success: true, data: rates });
});

const router = Router();
router.get('/rates', ratesHandler);

export default router;
