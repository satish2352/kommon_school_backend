import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { ApiError } from '@/utils/ApiError';

interface ValidationTargets {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
}

/**
 * Zod-based request validation middleware factory.
 * Validates req.body, req.query, and/or req.params against provided schemas.
 * On failure, throws a structured ApiError with field-level details.
 */
export function validate(targets: ValidationTargets) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (targets.body) {
        req.body = targets.body.parse(req.body);
      }
      if (targets.query) {
        req.query = targets.query.parse(req.query) as typeof req.query;
      }
      if (targets.params) {
        req.params = targets.params.parse(req.params) as typeof req.params;
      }
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        next(ApiError.validation(err));
      } else {
        next(err);
      }
    }
  };
}
