import { Request, Response } from 'express';
import { asyncHandler } from '@/utils/asyncHandler';
import { ApiResponse, parsePagination } from '@/utils/ApiResponse';
import { ApiError } from '@/utils/ApiError';
import { enrollmentsService } from './enrollments.service';
import { paymentsService } from '../payments/payments.service';
import { env } from '@/config/env';
import type { CreateEnrollmentInput, ListEnrollmentsQuery } from './enrollments.schema';

/**
 * POST /api/v1/enrollments
 * Create a new enrollment (public — no auth required).
 */
export const createEnrollment = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const body = req.body as CreateEnrollmentInput;

  // Pass tenant from context if available
  if (req.tenant?.id && !body.tenantId) {
    body.tenantId = req.tenant.id;
  }

  const { enrollment, created } = await enrollmentsService.createEnrollment(body);

  if (created) {
    ApiResponse.created(res, enrollment, 'Enrollment created successfully');
  } else {
    // Idempotent — already exists, return 200
    ApiResponse.success(res, enrollment, 'Enrollment already exists (idempotent)');
  }
});

/**
 * GET /api/v1/enrollments
 * List enrollments with filters. Requires ADMIN or MARKETING role.
 */
export const listEnrollments = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const query = req.query as unknown as ListEnrollmentsQuery;

  // Scope to tenant if not super admin
  if (req.user?.role !== 'SUPER_ADMIN' && req.tenant?.id) {
    query.tenantId = req.tenant.id;
  }

  const result = await enrollmentsService.listEnrollments(query);

  ApiResponse.paginated(res, result.items, {
    page: result.page,
    limit: result.limit,
    total: result.total,
  });
});

/**
 * GET /api/v1/enrollments/:id
 * Get single enrollment. Requires auth.
 */
export const getEnrollment = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const id = req.params['id'];
  if (!id) throw ApiError.badRequest('Enrollment ID is required');

  const enrollment = await enrollmentsService.getEnrollment(id);
  ApiResponse.success(res, enrollment);
});

/**
 * POST /api/v1/enrollments/:id/payment-order
 * Public — used by the marketing flow right after enrollment to get a Razorpay order.
 * Amount is read from env so ops can change pricing without a code deploy.
 */
export const createPaymentOrderForEnrollment = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const id = req.params['id'];
  if (!id) throw ApiError.badRequest('Enrollment ID is required');

  const enrollment = await enrollmentsService.getEnrollment(id);

  const result = await paymentsService.createOrder(
    {
      enrollmentId: enrollment.id,
      amount: env.ENROLLMENT_FEE_PAISE,
      currency: env.ENROLLMENT_FEE_CURRENCY,
      idempotencyKey: (req.body?.idempotencyKey as string | undefined),
    },
    enrollment.tenantId ?? null,
  );

  ApiResponse.success(
    res,
    {
      paymentId: result.payment.id,
      razorpayOrderId: result.razorpayOrder?.id ?? result.payment.razorpayOrderId,
      amount: env.ENROLLMENT_FEE_PAISE,
      currency: env.ENROLLMENT_FEE_CURRENCY,
      keyId: env.RAZORPAY_KEY_ID,
      enrollmentId: enrollment.enrollmentId,
    },
    'Payment order ready',
  );
});

/**
 * POST /api/v1/enrollments/:id/payment-verify
 * Public — Razorpay signature is the gate, not auth.
 */
export const verifyPaymentForEnrollment = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const id = req.params['id'];
  if (!id) throw ApiError.badRequest('Enrollment ID is required');

  const enrollment = await enrollmentsService.getEnrollment(id);

  const result = await paymentsService.verifyPayment(
    req.body,
    enrollment.tenantId ?? null,
  );
  ApiResponse.success(res, result, 'Payment verified');
});
