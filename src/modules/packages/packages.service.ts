import { v4 as uuid } from 'uuid';
import { prisma } from '../../lib/prisma';
import { ApiError } from '../../utils/ApiError';
import { roundMoney } from '../../utils/money';
import { initiatePayment } from '../payments/payments.service';
import { PurchasePackageInput } from './packages.validation';

export async function listCatalog() {
  return prisma.package.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } });
}

export async function getActivePackage(userId: string) {
  return prisma.userPackage.findFirst({
    where: { userId, status: 'ACTIVE' },
    include: { package: true },
    orderBy: { startedAt: 'desc' },
  });
}

export async function getHistory(userId: string) {
  return prisma.userPackage.findMany({
    where: { userId, status: { in: ['MATURED', 'CANCELLED'] } },
    include: { package: true },
    orderBy: { startedAt: 'desc' },
  });
}

export async function purchasePackage(userId: string, packageId: string, input: PurchasePackageInput) {
  const pkg = await prisma.package.findUnique({ where: { id: packageId } });
  if (!pkg || !pkg.isActive) throw ApiError.notFound('Package not found or no longer available');

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const principal = Number(pkg.minAmountUsd);
  const projectedReturn = roundMoney(principal + Number(pkg.fixedReturnUsd));
  const maturesAt = new Date(Date.now() + pkg.termDays * 24 * 60 * 60 * 1000);

  const { userPackage, transaction } = await prisma.$transaction(async (tx) => {
    const userPackage = await tx.userPackage.create({
      data: {
        userId,
        packageId: pkg.id,
        principalUsd: principal,
        projectedReturnUsd: projectedReturn,
        status: 'PENDING', // flips to ACTIVE once the Pesapal IPN confirms payment, or CANCELLED on failure
        maturesAt,
      },
    });

    const txRef = `pkg_${userPackage.id}_${uuid().slice(0, 8)}`;

    const transaction = await tx.transaction.create({
      data: {
        userId,
        type: 'PACKAGE_PURCHASE',
        status: 'PENDING',
        amountUsd: principal,
        currency: input.currency,
        userPackageId: userPackage.id,
        providerRef: txRef,
      },
    });

    return { userPackage, transaction };
  });

  const { redirectUrl } = await initiatePayment({
    amountUsd: principal,
    currency: input.currency,
    email: user.email,
    fullName: user.fullName,
    phone: user.phone ?? undefined,
    txRef: transaction.providerRef!,
    description: `${pkg.name} package purchase`,
  });

  return { transaction, userPackage, redirectUrl };
}
