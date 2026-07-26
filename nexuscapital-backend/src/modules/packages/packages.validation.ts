import { z } from 'zod';

export const purchasePackageSchema = z.object({
  body: z.object({
    method: z.enum(['MTN_MOBILE_MONEY', 'AIRTEL_MONEY', 'CARD', 'BANK_TRANSFER']),
    phone: z.string().min(7).max(20).optional(),
    currency: z.string().length(3).default('USD'),
  }),
  query: z.object({}).optional(),
  params: z.object({ id: z.string().uuid() }),
});

export type PurchasePackageInput = z.infer<typeof purchasePackageSchema>['body'];
