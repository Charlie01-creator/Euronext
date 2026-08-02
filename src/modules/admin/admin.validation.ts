import { z } from 'zod';

export const rejectWithdrawalSchema = z.object({
  body: z.object({
    reason: z.string().max(300).optional(),
  }),
  query: z.object({}).optional(),
  params: z.object({ id: z.string().uuid() }),
});

export const withdrawalIdSchema = z.object({
  body: z.object({}).optional(),
  query: z.object({}).optional(),
  params: z.object({ id: z.string().uuid() }),
});
