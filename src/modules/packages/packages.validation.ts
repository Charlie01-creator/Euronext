import { z } from 'zod';

export const purchasePackageSchema = z.object({
  body: z.object({
    currency: z.string().length(3).default('USD'),
  }),
  query: z.object({}).optional(),
  params: z.object({ id: z.string().uuid() }),
});

export type PurchasePackageInput = z.infer<typeof purchasePackageSchema>['body'];
