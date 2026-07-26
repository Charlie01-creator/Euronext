import http from 'http';
import { createApp } from './app';
import { env } from './config/env';
import { logger } from './config/logger';
import { prisma } from './lib/prisma';
import { redis } from './lib/redis';
import { initSocketServer } from './sockets/socket.server';
import { scheduleMaturityJob, startMaturityWorker } from './jobs/maturity.job';

async function main() {
  const app = createApp();
  const httpServer = http.createServer(app);

  initSocketServer(httpServer);
  const maturityWorker = startMaturityWorker();
  await scheduleMaturityJob();

  httpServer.listen(env.PORT, () => {
    logger.info(`🚀 NexusCapital API listening on port ${env.PORT} [${env.NODE_ENV}]`);
    logger.info(`📚 Swagger docs available at http://localhost:${env.PORT}/docs`);
  });

  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down gracefully…`);
    httpServer.close(async () => {
      await maturityWorker.close();
      await prisma.$disconnect();
      redis.disconnect();
      logger.info('Shutdown complete.');
      process.exit(0);
    });
    // force-exit if graceful shutdown hangs
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Unhandled promise rejection');
  });
}

main().catch((err) => {
  console.error('Fatal error during startup:', err);
  process.exit(1);
});
