import { z } from 'zod';
import { Router, Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { requireAuth } from '../../middleware/auth.middleware';
import { validate } from '../../middleware/validate.middleware';
import { catchAsync } from '../../utils/catchAsync';
import { ApiError } from '../../utils/ApiError';

// ── Validation ───────────────────────────────────────────────────
const updateProfileSchema = z.object({
  body: z.object({
    fullName: z.string().min(2).max(80).optional(),
    phone: z.string().min(7).max(20).optional(),
    country: z.string().optional(),
    defaultCurrency: z.string().length(3).optional(),
  }),
  query: z.object({}).optional(),
  params: z.object({}).optional(),
});

// ── Service ──────────────────────────────────────────────────────
async function getProfile(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      fullName: true,
      email: true,
      phone: true,
      country: true,
      referralCode: true,
      defaultCurrency: true,
      kycStatus: true,
      twoFactorEnabled: true,
      isEmailVerified: true,
      role: true,
      balanceUsd: true,
      createdAt: true,
    },
  });
  if (!user) throw ApiError.notFound('User not found');
  return user;
}

async function updateProfile(userId: string, data: z.infer<typeof updateProfileSchema>['body']) {
  return prisma.user.update({
    where: { id: userId },
    data,
    select: {
      id: true,
      fullName: true,
      email: true,
      phone: true,
      country: true,
      defaultCurrency: true,
    },
  });
}

// ── Controller ───────────────────────────────────────────────────
const meHandler = catchAsync(async (req: Request, res: Response) => {
  const profile = await getProfile(req.user!.id);
  res.json({ success: true, data: profile });
});

const updateMeHandler = catchAsync(async (req: Request, res: Response) => {
  const updated = await updateProfile(req.user!.id, req.body);
  res.json({ success: true, data: updated });
});

// ── Routes ───────────────────────────────────────────────────────
const router = Router();
router.use(requireAuth);

/**
 * @openapi
 * /users/me:
 *   get:
 *     tags: [Users]
 *     summary: Get the current user's profile
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Profile returned }
 *   patch:
 *     tags: [Users]
 *     summary: Update the current user's profile
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Profile updated }
 */
router.get('/me', meHandler);
router.patch('/me', validate(updateProfileSchema), updateMeHandler);

export default router;
