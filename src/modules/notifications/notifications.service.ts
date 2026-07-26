import { NotificationType } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { emitToUser } from '../../sockets/socket.server';
import { PaginationParams } from '../../utils/pagination';

interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  icon: string;
  color: string;
  title: string;
  description: string;
}

/** Creates a notification, persists it, and pushes it over Socket.IO to the user's connected devices. */
export async function createNotification(input: CreateNotificationInput) {
  const notification = await prisma.notification.create({ data: input });
  emitToUser(input.userId, 'notification:new', notification);
  return notification;
}

export async function listNotifications(userId: string, pagination: PaginationParams) {
  return prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    skip: pagination.skip,
    take: pagination.limit,
  });
}

export async function countNotifications(userId: string) {
  return prisma.notification.count({ where: { userId } });
}

export async function unreadCount(userId: string) {
  return prisma.notification.count({ where: { userId, isRead: false } });
}

export async function markOneRead(userId: string, notificationId: string) {
  await prisma.notification.updateMany({
    where: { id: notificationId, userId },
    data: { isRead: true },
  });
  emitToUser(userId, 'notification:read', { id: notificationId });
}

export async function markAllRead(userId: string) {
  await prisma.notification.updateMany({ where: { userId, isRead: false }, data: { isRead: true } });
  emitToUser(userId, 'notification:read-all', {});
}
