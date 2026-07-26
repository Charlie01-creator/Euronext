import { Request, Response, Router } from 'express';
import { catchAsync } from '../../utils/catchAsync';
import { ApiError } from '../../utils/ApiError';
import { prisma } from '../../lib/prisma';
import { logger } from '../../config/logger';
import * as flutterwave from './flutterwave.provider';
import * as paymentsService from './payments.service';

/**
 * @openapi
 * /payments/webhooks/flutterwave:
 *   post:
 *     tags: [Payments]
 *     summary: Flutterwave webhook receiver (deposits, package purchases, withdrawal payouts)
 *     description: Called by Flutterwave's servers, not by the frontend. Verified via the verif-hash header rather than a user session.
 *     responses:
 *       200: { description: Processed successfully }
 *       401: { description: Invalid or missing webhook signature }
 *       500: { description: Processing failed — Flutterwave will retry on a non-2xx response }
 */
const webhookHandler = catchAsync(async (req: Request, res: Response) => {
  const signature = req.headers['verif-hash'] as string | undefined;

  if (!flutterwave.verifyWebhookSignature(signature)) {
    // Recorded even though rejected — a real audit trail needs to show attempted forgeries too,
    // not just successfully-verified events.
    await prisma.webhookEvent.create({
      data: {
        eventType: req.body?.event ?? 'unknown',
        providerRef: req.body?.data?.tx_ref ?? req.body?.data?.reference ?? null,
        signatureValid: false,
        status: 'FAILED',
        payload: req.body ?? {},
        errorMessage: 'Webhook signature verification failed',
      },
    });
    logger.warn({ ip: req.ip }, 'Rejected Flutterwave webhook with invalid signature');
    throw ApiError.unauthorized('Invalid webhook signature');
  }

  // Processing is awaited *before* responding. Responding 200 first (the previous behavior) meant
  // Flutterwave considered the webhook delivered even if processing then failed — leaving the
  // transaction stuck PENDING forever with no retry, since the provider believed it had succeeded.
  // Awaiting here means a genuine failure surfaces as a 5xx, and Flutterwave's own retry
  // mechanism (built for exactly this) takes over. The compare-and-swap in payments.service.ts is
  // what makes retries safe rather than a double-processing risk.
  await paymentsService.handleFlutterwaveWebhook(req.body);
  res.status(200).json({ success: true });
});

const router = Router();
router.post('/webhooks/flutterwave', webhookHandler);

export default router;
