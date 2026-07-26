import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  APP_BASE_URL: z.string().default('http://localhost:4000'),
  API_BASE_URL: z.string().default('/api/v1'),
  // Comma-separated list of exact origins allowed to make credentialed cross-origin requests.
  // '*' is deliberately not a valid value here — it's incompatible with credentials:true per the
  // CORS spec, and if a client library ever silently tolerated it, it would allow any site to
  // make authenticated requests using a logged-in user's cookies.
  CORS_ORIGIN: z
    .string()
    .default('http://localhost:4000')
    .transform((val) => val.split(',').map((o) => o.trim()).filter(Boolean)),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

  JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET must be at least 16 characters'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET must be at least 16 characters'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),

  BCRYPT_SALT_ROUNDS: z.coerce.number().default(12),

  FLUTTERWAVE_PUBLIC_KEY: z.string().default(''),
  FLUTTERWAVE_SECRET_KEY: z.string().default(''),
  FLUTTERWAVE_WEBHOOK_SECRET_HASH: z.string().default(''),
  FLUTTERWAVE_BASE_URL: z.string().default('https://api.flutterwave.com/v3'),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000),
  RATE_LIMIT_MAX: z.coerce.number().default(100),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().default(10),

  LOG_LEVEL: z.string().default('info'),
  DEFAULT_CURRENCY: z.string().default('USD'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
