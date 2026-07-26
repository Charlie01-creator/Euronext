import { NextFunction, Request, Response } from 'express';
import { ApiError } from '../utils/ApiError';
import { logger } from '../config/logger';
import { isProd } from '../config/env';

export function notFoundHandler(req: Request, _res: Response, next: NextFunction) {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  const apiError =
    err instanceof ApiError
      ? err
      : new ApiError(500, isProd ? 'Internal server error' : (err as Error)?.message || 'Unknown error');

  if (!apiError.isOperational || apiError.statusCode >= 500) {
    logger.error({ err, path: req.originalUrl, requestId: req.requestId }, 'Unhandled error');
  }

  res.status(apiError.statusCode).json({
    success: false,
    message: apiError.message,
    details: apiError.details,
    requestId: req.requestId,
    ...(isProd ? {} : { stack: (err as Error)?.stack }),
  });
}
