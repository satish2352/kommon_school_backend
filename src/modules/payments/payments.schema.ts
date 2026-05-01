import { z } from 'zod';

// ── Create Order ──────────────────────────────────────────────────────────────

export const createOrderSchema = z.object({
  enrollmentId: z.string().min(1, 'enrollmentId is required'),
  amount: z.number().int('Amount must be an integer (paise)').positive('Amount must be positive'),
  currency: z.string().length(3).default('INR'),
  // Optional breakdown
  baseAmount: z.number().int().positive().optional(),
  taxAmount: z.number().int().min(0).optional(),
  discount: z.number().int().min(0).optional(),
  // Client idempotency key
  idempotencyKey: z.string().uuid().optional(),
  notes: z.record(z.string()).optional(),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;

// ── Verify Payment ────────────────────────────────────────────────────────────

export const verifyPaymentSchema = z.object({
  razorpayOrderId: z.string().min(1, 'razorpayOrderId is required'),
  razorpayPaymentId: z.string().min(1, 'razorpayPaymentId is required'),
  razorpaySignature: z.string().min(1, 'razorpaySignature is required'),
  paymentId: z.string().min(1, 'paymentId (internal) is required'),
});

export type VerifyPaymentInput = z.infer<typeof verifyPaymentSchema>;

// ── Webhook ───────────────────────────────────────────────────────────────────
// Webhook body is validated via signature only; not schema-validated (arbitrary payload)

// ── Heartbeat ─────────────────────────────────────────────────────────────────

export const heartbeatSchema = z.object({
  paymentId: z.string().min(1, 'paymentId is required'),
  razorpayOrderId: z.string().optional(),
});

export type HeartbeatInput = z.infer<typeof heartbeatSchema>;

// ── Refund ────────────────────────────────────────────────────────────────────

export const refundSchema = z.object({
  paymentId: z.string().min(1, 'paymentId is required'),
  amount: z.number().int().positive().optional(), // paise; if omitted = full refund
  reason: z.string().max(500).optional(),
  idempotencyKey: z.string().uuid().optional(),
});

export type RefundInput = z.infer<typeof refundSchema>;

// ── Payment Status Query ──────────────────────────────────────────────────────

export const paymentIdParamSchema = z.object({
  id: z.string().min(1, 'Payment ID is required'),
});

export const listPaymentsQuerySchema = z.object({
  page: z.string().optional().default('1'),
  limit: z.string().optional().default('20'),
  status: z
    .enum(['INITIATED', 'CREATED', 'IN_PROGRESS', 'PENDING', 'SUCCESS', 'FAILED', 'PARTIAL', 'REFUNDED', 'EXPIRED'])
    .optional(),
  enrollmentId: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  tenantId: z.string().optional(),
});

export type ListPaymentsQuery = z.infer<typeof listPaymentsQuerySchema>;
