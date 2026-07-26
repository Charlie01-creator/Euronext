import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';

/** Attaches a request ID (reusing an inbound X-Request-Id if the caller/proxy already set one) and echoes it back in the response header, so a single request can be traced across every log line it produces. */
export function requestId(req: Request, res: Response, next: NextFunction) {
  const incoming = req.headers['x-request-id'];
  req.requestId = typeof incoming === 'string' && incoming.length > 0 ? incoming : randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
}
