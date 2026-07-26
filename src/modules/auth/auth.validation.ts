import { z } from 'zod';

export const registerSchema = z.object({
  body: z.object({
    fullName: z.string().min(2, 'Full name is too short').max(80),
    email: z.string().email('Invalid email address'),
    phone: z.string().min(7).max(20).optional(),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .regex(/[A-Z]/, 'Password must contain an uppercase letter')
      .regex(/[0-9]/, 'Password must contain a number'),
    country: z.string().optional(),
    referralCode: z.string().optional(),
  }),
  query: z.object({}).optional(),
  params: z.object({}).optional(),
});

export const loginSchema = z
  .object({
    body: z.object({
      email: z.string().email().optional(),
      phoneNumber: z.string().min(7).max(20).optional(),
      fullName: z.string().optional(), // sent by the phone-based login form; used for display only, not authentication
      password: z.string().min(1, 'Password is required'),
      rememberMe: z.boolean().optional().default(false),
    }),
    query: z.object({}).optional(),
    params: z.object({}).optional(),
  })
  .refine((data) => Boolean(data.body.email) || Boolean(data.body.phoneNumber), {
    message: 'Either email or phoneNumber is required',
    path: ['body', 'email'],
  });

export const verifyEmailSchema = z.object({
  body: z.object({ token: z.string().min(1) }),
  query: z.object({}).optional(),
  params: z.object({}).optional(),
});

export const revokeSessionSchema = z.object({
  body: z.object({}).optional(),
  query: z.object({}).optional(),
  params: z.object({ id: z.string().uuid() }),
});

export const forgotPasswordSchema = z.object({
  body: z.object({
    phoneNumber: z.string().min(7).max(20),
  }),
  query: z.object({}).optional(),
  params: z.object({}).optional(),
});

export const resetPasswordSchema = z.object({
  body: z.object({
    token: z.string().min(1),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .regex(/[A-Z]/, 'Password must contain an uppercase letter')
      .regex(/[0-9]/, 'Password must contain a number'),
  }),
  query: z.object({}).optional(),
  params: z.object({}).optional(),
});

export const refreshSchema = z.object({
  body: z.object({
    refreshToken: z.string().min(1).optional(), // optional because it may arrive via httpOnly cookie instead
  }),
  query: z.object({}).optional(),
  params: z.object({}).optional(),
});

export type RegisterInput = z.infer<typeof registerSchema>['body'];
export type LoginInput = z.infer<typeof loginSchema>['body'];
