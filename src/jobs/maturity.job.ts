import { Queue, Worker, Job } from 'bullmq';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { prisma } from '../lib/prisma';
import { roundMoney } from '../utils/money';
import { createNotification } from '../modules/notifications/notifications.service';
import { emitToUser } from '../sockets/socket.server';

const connection = { url: env.REDIS_URL };
const QUEUE_NAME = 'package-maturity';

export const maturityQueue = new Queue(QUEUE_NAME, { connection });

async function processMaturities() {
  const duePackages = await prisma.userPackage.findMany({
    where: { status: 'ACTIVE', maturesAt: { lte: new Date() } },
    include: { package: true },
  });

  for (const pkg of duePackages) {
    const returnAmount = roundMoney(Number(pkg.projectedReturnUsd) - Number(pkg.principalUsd));

    await prisma.$transaction(async (tx) => {
      await tx.userPackage.update({
        where: { id: pkg.id },
        data: { status: 'MATURED', endedAt: new Date() },
      });

      await tx.transaction.create({
        data: {
          userId: pkg.userId,
          type: 'PACKAGE_RETURN',
          status: 'COMPLETED',
          amountUsd: returnAmount,
          userPackageId: pkg.id,
        },
      });

      // credit principal + return back to the user's withdrawable balance
      await tx.user.update({
        where: { id: pkg.userId },
        data: { balanceUsd: { increment: pkg.projectedReturnUsd } },
      });
    });

    await createNotification({
      userId: pkg.userId,
      type: 'PACKAGE',
      icon: 'fa-trophy',
      color: 'gold',
      title: `${pkg.package.name} package matured`,
      description: `Your ${pkg.package.name} package matured with a return of $${returnAmount.toLocaleString()}. Funds have been added to your balance.`,
    });

    emitToUser(pkg.userId, 'wallet:update', { userPackageId: pkg.id, status: 'MATURED' });
    logger.info({ userPackageId: pkg.id, userId: pkg.userId }, 'Package matured');
  }

  return { processed: duePackages.length };
}

export function startMaturityWorker() {
  const worker = new Worker(
    QUEUE_NAME,
    async (job: Job) => {
      logger.info({ jobId: job.id }, 'Running package maturity sweep');
      return processMaturities();
    },
    { connection }
  );

  worker.on('completed', (job, result) => {
    logger.info({ jobId: job.id, result }, 'Maturity sweep completed');
  });
  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Maturity sweep failed');
  });

  return worker;
}

/** Schedules the sweep to run every hour, on top of running once immediately at boot. */
export async function scheduleMaturityJob() {
  await maturityQueue.add('sweep', {}, { repeat: { every: 60 * 60 * 1000 } });
  await maturityQueue.add('sweep-initial', {});
}
