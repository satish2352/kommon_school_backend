import { Router } from 'express';
import { validate } from '@/middlewares/validate.middleware';
import { authenticate, authorize } from '@/middlewares/auth.middleware';
import { sensitiveRateLimiter } from '@/middlewares/rateLimiter.middleware';
import {
  createEnrollment,
  listEnrollments,
  getEnrollment,
  createPaymentOrderForEnrollment,
  verifyPaymentForEnrollment,
} from './enrollments.controller';
import { createEnrollmentSchema, listEnrollmentsQuerySchema } from './enrollments.schema';
import { verifyPaymentSchema } from '../payments/payments.schema';
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

/**
 * POST /api/v1/enrollments/:id/payment-order
 * Public — used by the marketing flow to obtain a Razorpay order using the env-configured fee.
 */
router.post(
  '/:id/payment-order',
  sensitiveRateLimiter,
  validate({ params: z.object({ id: z.string().min(1) }) }),
  createPaymentOrderForEnrollment,
);

/**
 * POST /api/v1/enrollments/:id/payment-verify
 * Public — confirms a Razorpay client-side payment. Razorpay signature is the gate.
 */
router.post(
  '/:id/payment-verify',
  sensitiveRateLimiter,
  validate({ params: z.object({ id: z.string().min(1) }), body: verifyPaymentSchema }),
  verifyPaymentForEnrollment,
);

export default router;
