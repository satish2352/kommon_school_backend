import { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Wraps an async route handler to forward errors to Express error middleware.
 * Eliminates try/catch boilerplate in every controller.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void | Response>,
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
