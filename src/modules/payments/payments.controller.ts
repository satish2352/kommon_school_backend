import { Request, Response } from 'express';
import { asyncHandler } from '@/utils/asyncHandler';
import { ApiResponse, parsePagination } from '@/utils/ApiResponse';
import { ApiError } from '@/utils/ApiError';
import { paymentsService } from './payments.service';
import type {
  CreateOrderInput,
  VerifyPaymentInput,
  HeartbeatInput,
  RefundInput,
  ListPaymentsQuery,
} from './payments.schema';

/**
 * POST /api/v1/payments/orders
 * Create Razorpay order. Requires auth.
 */
export const createOrder = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const body = req.body as CreateOrderInput;
  const tenantId = req.tenant?.id ?? req.user?.tenantId ?? null;

  const result = await paymentsService.createOrder(body, tenantId);

  if (result.created) {
    ApiResponse.created(res, result, 'Payment order created');
  } else {
    ApiResponse.success(res, result, 'Payment order already exists (idempotent)');
  }
});

/**
 * POST /api/v1/payments/verify
 * Verify client-side payment signature. Requires auth.
 */
export const verifyPayment = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const body = req.body as VerifyPaymentInput;
  const tenantId = req.tenant?.id ?? req.user?.tenantId ?? null;

  const result = await paymentsService.verifyPayment(body, tenantId);
  ApiResponse.success(res, result, 'Payment verified');
});

/**
 * POST /api/v1/payments/heartbeat
 * Client heartbeat for in-progress payment.
 */
export const heartbeat = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const body = req.body as HeartbeatInput;
  const result = await paymentsService.heartbeat(body);
  ApiResponse.success(res, result, 'Heartbeat recorded');
});

/**
 * POST /api/v1/payments/refund
 * Process refund. Requires ADMIN role.
 */
export const refundPayment = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const body = req.body as RefundInput;
  const tenantId = req.tenant?.id ?? req.user?.tenantId ?? null;

  const result = await paymentsService.refund(body, tenantId);
  ApiResponse.success(res, result, 'Refund processed successfully');
});

/**
 * GET /api/v1/payments/:id
 * Get payment by ID. Requires auth.
 */
export const getPayment = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const id = req.params['id'];
  if (!id) throw ApiError.badRequest('Payment ID is required');

  const payment = await paymentsService.getPayment(id);
  ApiResponse.success(res, payment);
});

/**
 * GET /api/v1/payments
 * List payments with filters. Requires ADMIN.
 */
export const listPayments = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const query = req.query as unknown as ListPaymentsQuery;

  if (req.user?.role !== 'SUPER_ADMIN' && req.tenant?.id) {
    query.tenantId = req.tenant.id;
  }

  const result = await paymentsService.listPayments(query);
  ApiResponse.paginated(res, result.items, {
    page: result.page,
    limit: result.limit,
    total: result.total,
  });
});

/**
 * GET /api/v1/payments/failed
 * List failed payments. Requires ADMIN.
 */
export const listFailedPayments = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const query = req.query as unknown as ListPaymentsQuery;

  if (req.user?.role !== 'SUPER_ADMIN' && req.tenant?.id) {
    query.tenantId = req.tenant.id;
  }

  const result = await paymentsService.listFailedPayments(query);
  ApiResponse.paginated(res, result.items, {
    page: result.page,
    limit: result.limit,
    total: result.total,
  }, 'Failed payments');
});
