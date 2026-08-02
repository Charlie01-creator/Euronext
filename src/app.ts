import express, { Express, Request } from 'express';
import path from 'path';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import swaggerUi from 'swagger-ui-express';

import { env } from './config/env';
import { logger } from './config/logger';
import { swaggerSpec } from './config/swagger';
import { prisma } from './lib/prisma';
import { redis } from './lib/redis';
import { generalLimiter } from './middleware/rateLimit.middleware';
import { errorHandler, notFoundHandler } from './middleware/error.middleware';
import { requestId } from './middleware/requestId.middleware';

const helmetConfig = {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // 'unsafe-inline' is required because the dashboard/login/register pages use inline
      // <script>/<style> blocks rather than external files — a real nonce-based CSP would need
      // those extracted to separate files first, noted as a follow-up in the README.
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdn.socket.io', 'https://cdnjs.cloudflare.com'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://cdnjs.cloudflare.com'],
      fontSrc: ["'self'", 'https://cdnjs.cloudflare.com', 'data:'],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      ...(env.NODE_ENV === 'production' ? { upgradeInsecureRequests: [] } : {}),
    },
  },
};

import authRoutes from './modules/auth/auth.routes';
import usersRoutes from './modules/users/users.routes';
import packagesRoutes from './modules/packages/packages.routes';
import depositsRoutes from './modules/deposits/deposits.routes';
import withdrawalsRoutes from './modules/withdrawals/withdrawals.routes';
import referralsRoutes from './modules/referrals/referrals.routes';
import notificationsRoutes from './modules/notifications/notifications.routes';
import analyticsRoutes from './modules/analytics/analytics.routes';
import securityRoutes from './modules/security/security.routes';
import currencyRoutes from './modules/currency/currency.routes';
import paymentsRoutes from './modules/payments/payments.routes';
import adminRoutes from './modules/admin/admin.routes';

export function createApp(): Express {
  const app = express();

  // Trusts the X-Forwarded-For header from exactly one hop in front of this app (the optional
  // Nginx reverse proxy in docker/nginx.conf). Without this, req.ip resolves to the proxy's own
  // address for every request — every user gets rate-limited/bucketed together, and login
  // activity records the proxy's IP instead of the real client's.
  app.set('trust proxy', 1);

  app.use(helmet(helmetConfig));
  app.use(
    cors({
      origin(requestOrigin, callback) {
        // Same-origin requests (no Origin header — curl, server-to-server, the webhook) are always allowed.
        if (!requestOrigin || env.CORS_ORIGIN.includes(requestOrigin)) {
          callback(null, true);
        } else {
          callback(new Error(`Origin ${requestOrigin} is not allowed by CORS policy`));
        }
      },
      credentials: true,
    })
  );
  app.use(compression());
  app.use(cookieParser());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(requestId);
  app.use(pinoHttp({ logger, customProps: (req) => ({ requestId: (req as Request).requestId }) }));
  app.use(generalLimiter);

  app.get('/health', (_req, res) => res.json({ success: true, status: 'ok', timestamp: new Date().toISOString() }));

  // Liveness (/health) only confirms the Node process is running and responding — it says
  // nothing about whether the app can actually do its job. Readiness checks the two things this
  // app cannot function without: Postgres and Redis. An orchestrator (or a load balancer) should
  // route traffic based on THIS, not /health — a process that's alive but can't reach its database
  // should be taken out of rotation, not sent requests it can only fail.
  app.get('/health/ready', async (_req, res) => {
    const checks: Record<string, boolean> = {};

    try {
      await prisma.$queryRaw`SELECT 1`;
      checks.database = true;
    } catch {
      checks.database = false;
    }

    try {
      const pong = await redis.ping();
      checks.redis = pong === 'PONG';
    } catch {
      checks.redis = false;
    }

    const isReady = Object.values(checks).every(Boolean);
    res.status(isReady ? 200 : 503).json({ success: isReady, status: isReady ? 'ready' : 'not_ready', checks });
  });

  // ── Frontend (served from the same origin as the API) ──────────
  const publicDir = path.join(__dirname, '..', 'public');
  app.use(express.static(publicDir)); // serves index.html for '/' automatically — no manual route needed

  app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
  app.get('/docs.json', (_req, res) => res.json(swaggerSpec));

  const base = env.API_BASE_URL;
  app.use(`${base}/auth`, authRoutes);
  app.use(`${base}/users`, usersRoutes);
  app.use(`${base}/packages`, packagesRoutes);
  app.use(`${base}/deposits`, depositsRoutes);
  app.use(`${base}/withdrawals`, withdrawalsRoutes);
  app.use(`${base}/referrals`, referralsRoutes);
  app.use(`${base}/notifications`, notificationsRoutes);
  app.use(`${base}/analytics`, analyticsRoutes);
  app.use(`${base}/security`, securityRoutes);
  app.use(`${base}/currency`, currencyRoutes);
  app.use(`${base}/payments`, paymentsRoutes);
  app.use(`${base}/admin`, adminRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
