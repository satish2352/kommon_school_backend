import { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { ApiError } from '@/utils/ApiError';
import { logger } from '@/config/logger';

/**
 * Centralized error handler.
 * - Converts known errors (Prisma, ApiError) to structured JSON responses.
 * - Never exposes internal stack traces to clients.
 * - Logs all errors with request context.
 */
export function errorHandlerMiddleware(
  err: Error,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  // Already handled — response started
  if (res.headersSent) {
    return;
  }

  let apiError: ApiError;

  if (err instanceof ApiError) {
    apiError = err;
  } else if (err instanceof Prisma.PrismaClientKnownRequestError) {
    apiError = handlePrismaError(err);
  } else if (err instanceof Prisma.PrismaClientValidationError) {
    apiError = ApiError.badRequest('Database validation error');
  } else if (err instanceof Prisma.PrismaClientInitializationError) {
    apiError = ApiError.serviceUnavailable('Database connection failed');
  } else {
    // Unknown / programming error
    apiError = new ApiError(500, 'An unexpected error occurred', 'INTERNAL_SERVER_ERROR', null, false);
  }

  // Log
  const logLevel = apiError.statusCode >= 500 ? 'error' : apiError.statusCode >= 400 ? 'warn' : 'info';
  logger[logLevel]({
    requestId: req.requestId,
    err: {
      name: err.name,
      message: err.message,
      code: apiError.code,
      statusCode: apiError.statusCode,
      ...(apiError.statusCode >= 500 && { stack: err.stack }),
    },
    method: req.method,
    path: req.path,
    userId: req.user?.id,
    tenantId: req.tenant?.id,
  }, `Error: ${err.message}`);

  res.status(apiError.statusCode).json(apiError.toJSON());
}

function handlePrismaError(err: Prisma.PrismaClientKnownRequestError): ApiError {
  switch (err.code) {
    case 'P2002': {
      // Unique constraint violation
      const fields = (err.meta?.['target'] as string[])?.join(', ') ?? 'field';
      return ApiError.conflict(`A record with this ${fields} already exists`);
    }
    case 'P2025':
      return ApiError.notFound('Record');
    case 'P2003':
      return ApiError.badRequest('Related record not found');
    case 'P2004':
      return ApiError.badRequest('Database constraint violation');
    case 'P2016':
      return ApiError.notFound('Record');
    case 'P2014':
      return ApiError.badRequest('Invalid relation in request');
    default:
      return new ApiError(500, 'Database error', 'DB_ERROR', null, false);
  }
}

/**
 * 404 handler — must be registered after all routes
 */
export function notFoundMiddleware(req: Request, _res: Response, next: NextFunction): void {
  next(ApiError.notFound(`Route ${req.method} ${req.path}`));
}
