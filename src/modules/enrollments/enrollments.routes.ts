import { Router } from 'express';
import { validate } from '@/middlewares/validate.middleware';
import { authenticate, authorize } from '@/middlewares/auth.middleware';
import { sensitiveRateLimiter } from '@/middlewares/rateLimiter.middleware';
import { createEnrollment, listEnrollments, getEnrollment } from './enrollments.controller';
import { createEnrollmentSchema, listEnrollmentsQuerySchema } from './enrollments.schema';
import { z } from 'zod';

const router = Router();

/**
 * POST /api/v1/enrollments
 * Public endpoint — rate-limited to prevent abuse.
 */
router.post(
  '/',
  sensitiveRateLimiter,
  validate({ body: createEnrollmentSchema }),
  createEnrollment,
);

/**
 * GET /api/v1/enrollments
 * Admin / Marketing — paginated list with filters.
 */
router.get(
  '/',
  authenticate,
  authorize('ADMIN', 'SUPER_ADMIN', 'MARKETING', 'SCHOOL_ADMIN'),
  validate({ query: listEnrollmentsQuerySchema }),
  listEnrollments,
);

/**
 * GET /api/v1/enrollments/:id
 * Get single enrollment detail.
 */
router.get(
  '/:id',
  authenticate,
  authorize('ADMIN', 'SUPER_ADMIN', 'MARKETING', 'SCHOOL_ADMIN'),
  validate({ params: z.object({ id: z.string().min(1) }) }),
  getEnrollment,
);

export default router;
