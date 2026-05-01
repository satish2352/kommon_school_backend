import { Request, Response, NextFunction } from 'express';
import { logger } from '@/config/logger';

/**
 * Structured request/response logging middleware.
 * Logs: method, path, status, latency, requestId, userId, tenantId.
 * Never logs request bodies (may contain PII/secrets).
 */
export function requestLoggerMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const level =
      res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';

    logger[level]({
      requestId: req.requestId,
      method: req.method,
      path: req.path,
      query: Object.keys(req.query).length > 0 ? req.query : undefined,
      statusCode: res.statusCode,
      duration,
      userId: req.user?.id,
      tenantId: req.tenant?.id ?? req.user?.tenantId,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    }, `${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
  });

  next();
}
