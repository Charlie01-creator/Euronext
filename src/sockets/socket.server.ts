import { Server as HttpServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { verifyAccessToken } from '../utils/jwt';

let io: SocketIOServer | undefined;

export function initSocketServer(httpServer: HttpServer): SocketIOServer {
  io = new SocketIOServer(httpServer, {
    cors: { origin: env.CORS_ORIGIN, credentials: true },
  });

  // Authenticate the socket handshake using the same access token as the REST API.
  io.use((socket: Socket, next) => {
    const token =
      (socket.handshake.auth?.token as string | undefined) ??
      (socket.handshake.headers.authorization?.toString().replace('Bearer ', '') as string | undefined);

    if (!token) return next(new Error('Missing authentication token'));

    try {
      const payload = verifyAccessToken(token);
      socket.data.userId = payload.sub;
      next();
    } catch {
      next(new Error('Invalid or expired token'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const userId = socket.data.userId as string;
    socket.join(`user:${userId}`); // private room — only this user's events land here
    logger.info({ userId, socketId: socket.id }, 'Socket connected');

    socket.on('disconnect', () => {
      logger.info({ userId, socketId: socket.id }, 'Socket disconnected');
    });
  });

  return io;
}

export function getSocketServer(): SocketIOServer {
  if (!io) throw new Error('Socket.IO server has not been initialized yet');
  return io;
}

/** Push a notification to a specific user's connected devices in real time. */
export function emitToUser(userId: string, event: string, payload: unknown): void {
  io?.to(`user:${userId}`).emit(event, payload);
}
