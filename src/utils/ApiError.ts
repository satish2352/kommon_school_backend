import { ZodError } from 'zod';

export interface ApiErrorDetail {
  field?: string;
  message: string;
  code?: string;
}

export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details: ApiErrorDetail[] | null;
  public readonly isOperational: boolean;

  constructor(
    statusCode: number,
    message: string,
    code: string,
    details: ApiErrorDetail[] | null = null,
    isOperational = true,
  ) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = isOperational;

    // Maintain proper stack trace in V8
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ApiError);
    }
  }

  // ── Factory helpers ───────────────────────────────────────

  static badRequest(message: string, details?: ApiErrorDetail[]): ApiError {
    return new ApiError(400, message, 'BAD_REQUEST', details ?? null);
  }

  static validation(error: ZodError): ApiError {
    const details: ApiErrorDetail[] = error.errors.map((e) => ({
      field: e.path.join('.'),
      message: e.message,
      code: e.code,
    }));
    return new ApiError(422, 'Validation failed', 'VALIDATION_ERROR', details);
  }

  static unauthorized(message = 'Authentication required'): ApiError {
    return new ApiError(401, message, 'UNAUTHORIZED');
  }

  static forbidden(message = 'Insufficient permissions'): ApiError {
    return new ApiError(403, message, 'FORBIDDEN');
  }

  static notFound(resource = 'Resource'): ApiError {
    return new ApiError(404, `${resource} not found`, 'NOT_FOUND');
  }

  static conflict(message: string): ApiError {
    return new ApiError(409, message, 'CONFLICT');
  }

  static unprocessable(message: string, details?: ApiErrorDetail[]): ApiError {
    return new ApiError(422, message, 'UNPROCESSABLE_ENTITY', details ?? null);
  }

  static tooManyRequests(message = 'Too many requests, please try again later'): ApiError {
    return new ApiError(429, message, 'TOO_MANY_REQUESTS');
  }

  static internal(message = 'Internal server error'): ApiError {
    return new ApiError(500, message, 'INTERNAL_SERVER_ERROR', null, false);
  }

  static serviceUnavailable(message = 'Service temporarily unavailable'): ApiError {
    return new ApiError(503, message, 'SERVICE_UNAVAILABLE');
  }

  toJSON(): Record<string, unknown> {
    return {
      success: false,
      error: {
        code: this.code,
        message: this.message,
        details: this.details,
      },
    };
  }
}
