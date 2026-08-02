import { Request, Response, Router } from 'express';
import { catchAsync } from '../../utils/catchAsync';
import { logger } from '../../config/logger';
import { webhookLimiter } from '../../middleware/rateLimit.middleware';
import * as paymentsService from './payments.service';

/**
 * @openapi
 * /payments/ipn/pesapal:
 *   post:
 *     tags: [Payments]
 *     summary: Pesapal IPN (Instant Payment Notification) receiver
 *     description: >
 *       Called by Pesapal's servers, not the frontend. Registered once via RegisterIPN at
 *       submit-order time (see pesapal.provider.ts). Pesapal's contract is different from a
 *       typical webhook: it expects a structured JSON body confirming receipt — status 200 means
 *       "received and processed", 500 means "received but something went wrong on our end" — sent
 *       with an HTTP 200 either way. Sending the wrong shape, or a non-200 HTTP status, causes
 *       Pesapal to keep retrying indefinitely rather than treating it as a normal failure.
 *     responses:
 *       200: { description: Acknowledgment in Pesapal's expected JSON shape }
 */
const ipnHandler = catchAsync(async (req: Request, res: Response) => {
  // Pesapal's own examples show these arriving as query params even on a POST-registered IPN,
  // so both are checked defensively rather than assuming one or the other.
  const orderTrackingId = (req.query.OrderTrackingId ?? req.body?.OrderTrackingId) as string | undefined;
  const orderMerchantReference = (req.query.OrderMerchantReference ?? req.body?.OrderMerchantReference) as
    | string
    | undefined;
  const orderNotificationType = (req.query.OrderNotificationType ?? req.body?.OrderNotificationType ?? 'IPNCHANGE') as string;

  if (!orderTrackingId || !orderMerchantReference) {
    logger.warn({ query: req.query, body: req.body }, 'Pesapal IPN missing required identifiers');
    return res.status(200).json({
      orderNotificationType,
      orderTrackingId: orderTrackingId ?? '',
      orderMerchantReference: orderMerchantReference ?? '',
      status: 500,
    });
  }

  try {
    await paymentsService.handlePesapalIpn(orderTrackingId, orderMerchantReference);
    res.status(200).json({ orderNotificationType, orderTrackingId, orderMerchantReference, status: 200 });
  } catch (err) {
    logger.error({ err, orderTrackingId, orderMerchantReference }, 'Pesapal IPN processing failed');
    // Still HTTP 200 — Pesapal's retry behavior is driven by the status field in the body, not
    // the HTTP status code. Returning a 5xx here would not trigger a "nicer" retry; it would just
    // be a malformed response from Pesapal's perspective.
    res.status(200).json({ orderNotificationType, orderTrackingId, orderMerchantReference, status: 500 });
  }
});

const router = Router();
router.post('/ipn/pesapal', webhookLimiter, ipnHandler);

export default router;
