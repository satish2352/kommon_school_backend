import { ApiError } from '../../src/utils/ApiError';
import { ZodError, z } from 'zod';

describe('ApiError', () => {
  describe('factory methods', () => {
    it('creates a 400 bad request error', () => {
      const err = ApiError.badRequest('Bad input');
      expect(err).toBeInstanceOf(ApiError);
      expect(err.statusCode).toBe(400);
      expect(err.code).toBe('BAD_REQUEST');
      expect(err.message).toBe('Bad input');
      expect(err.isOperational).toBe(true);
    });

    it('creates a 401 unauthorized error', () => {
      const err = ApiError.unauthorized();
      expect(err.statusCode).toBe(401);
      expect(err.code).toBe('UNAUTHORIZED');
    });

    it('creates a 403 forbidden error', () => {
      const err = ApiError.forbidden();
      expect(err.statusCode).toBe(403);
      expect(err.code).toBe('FORBIDDEN');
    });

    it('creates a 404 not found error', () => {
      const err = ApiError.notFound('User');
      expect(err.statusCode).toBe(404);
      expect(err.message).toBe('User not found');
    });

    it('creates a 409 conflict error', () => {
      const err = ApiError.conflict('Already exists');
      expect(err.statusCode).toBe(409);
      expect(err.code).toBe('CONFLICT');
    });

    it('creates a 429 too many requests error', () => {
      const err = ApiError.tooManyRequests();
      expect(err.statusCode).toBe(429);
      expect(err.code).toBe('TOO_MANY_REQUESTS');
    });

    it('creates a 500 internal server error', () => {
      const err = ApiError.internal();
      expect(err.statusCode).toBe(500);
      expect(err.isOperational).toBe(false);
    });
  });

  describe('validation factory', () => {
    it('converts ZodError to structured ApiError', () => {
      const schema = z.object({ name: z.string().min(1) });
      let zodError: ZodError | null = null;

      try {
        schema.parse({ name: '' });
      } catch (e) {
        zodError = e as ZodError;
      }

      expect(zodError).not.toBeNull();
      const apiError = ApiError.validation(zodError!);
      expect(apiError.statusCode).toBe(422);
      expect(apiError.code).toBe('VALIDATION_ERROR');
      expect(apiError.details).toHaveLength(1);
      expect(apiError.details![0]!.field).toBe('name');
    });
  });

  describe('toJSON', () => {
    it('serializes correctly for response body', () => {
      const err = ApiError.badRequest('Bad input', [{ field: 'email', message: 'Invalid' }]);
      const json = err.toJSON();

      expect(json).toEqual({
        success: false,
        error: {
          code: 'BAD_REQUEST',
          message: 'Bad input',
          details: [{ field: 'email', message: 'Invalid' }],
        },
      });
    });
  });
});
