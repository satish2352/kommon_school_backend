import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { runWithContext, createRequestContext } from '@/utils/requestContext';

/**
 * Attaches a unique request ID and context to every request.
 * Uses AsyncLocalStorage so downstream code can access context without
 * threading req through every function call.
 */
export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId = (req.headers['x-request-id'] as string) ?? uuidv4();
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);

  const context = createRequestContext({
    requestId,
    ip: req.ip ?? req.socket.remoteAddress,
    path: req.path,
  });

  runWithContext(context, () => next());
}
