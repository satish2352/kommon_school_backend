import { Router } from 'express';
import express from 'express';
import { validate } from '@/middlewares/validate.middleware';
import { authenticate, authorize } from '@/middlewares/auth.middleware';
import { sensitiveRateLimiter, globalRateLimiter } from '@/middlewares/rateLimiter.middleware';
import {
  createOrder,
  verifyPayment,
  heartbeat,
  refundPayment,
  getPayment,
  listPayments,
  listFailedPayments,
} from './payments.controller';
import { handleWebhook } from './payments.webhook';
import {
  createOrderSchema,
  verifyPaymentSchema,
  heartbeatSchema,
  refundSchema,
  listPaymentsQuerySchema,
} from './payments.schema';
import { z } from 'zod';

const router = Router();

// ── Webhook — must use raw body parser BEFORE json ────────────────────────────
// This route is public (Razorpay calls it) but signature-verified
router.post(
  '/webhook',
  express.raw({ type: '*/*', limit: '1mb' }),
  handleWebhook,
);

// ── Payment order creation ────────────────────────────────────────────────────
router.post(
  '/orders',
  sensitiveRateLimiter,
  authenticate,
  validate({ body: createOrderSchema }),
  createOrder,
);

// ── Payment verification (client-side) ───────────────────────────────────────
router.post(
  '/verify',
  sensitiveRateLimiter,
  authenticate,
  validate({ body: verifyPaymentSchema }),
  verifyPayment,
);

// ── Heartbeat ─────────────────────────────────────────────────────────────────
router.post(
  '/heartbeat',
  globalRateLimiter,
  authenticate,
  validate({ body: heartbeatSchema }),
  heartbeat,
);

// ── Refund ────────────────────────────────────────────────────────────────────
router.post(
  '/refund',
  sensitiveRateLimiter,
  authenticate,
  authorize('ADMIN', 'SUPER_ADMIN', 'SCHOOL_ADMIN'),
  validate({ body: refundSchema }),
  refundPayment,
);

// ── List failed payments ──────────────────────────────────────────────────────
router.get(
  '/failed',
  authenticate,
  authorize('ADMIN', 'SUPER_ADMIN', 'SCHOOL_ADMIN', 'MARKETING'),
  validate({ query: listPaymentsQuerySchema }),
  listFailedPayments,
);

// ── List payments ─────────────────────────────────────────────────────────────
router.get(
  '/',
  authenticate,
  authorize('ADMIN', 'SUPER_ADMIN', 'SCHOOL_ADMIN'),
  validate({ query: listPaymentsQuerySchema }),
  listPayments,
);

// ── Get payment by ID ─────────────────────────────────────────────────────────
router.get(
  '/:id',
  authenticate,
  validate({ params: z.object({ id: z.string().min(1) }) }),
  getPayment,
);

export default router;
