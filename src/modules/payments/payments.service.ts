import { v4 as uuidv4 } from 'uuid';
import { prisma } from '@/config/database';
import { ApiError } from '@/utils/ApiError';
import { logger } from '@/config/logger';
import { env } from '@/config/env';
import { paymentsRepository } from './payments.repository';
import {
  createRazorpayOrder,
  verifyPaymentSignature,
  createRazorpayRefund,
  fetchRazorpayPayment,
} from '@/utils/razorpay';
import type {
  CreateOrderInput,
  VerifyPaymentInput,
  HeartbeatInput,
  RefundInput,
  ListPaymentsQuery,
} from './payments.schema';

// ── State machine valid transitions ──────────────────────────────────────────

const VALID_TRANSITIONS: Record<string, string[]> = {
  INITIATED: ['CREATED', 'FAILED', 'EXPIRED'],
  CREATED: ['IN_PROGRESS', 'PENDING', 'FAILED', 'EXPIRED'],
  IN_PROGRESS: ['PENDING', 'SUCCESS', 'FAILED', 'PARTIAL', 'EXPIRED'],
  PENDING: ['SUCCESS', 'FAILED', 'PARTIAL', 'EXPIRED', 'IN_PROGRESS'],
  PARTIAL: ['SUCCESS', 'REFUNDED', 'FAILED'],
  SUCCESS: ['REFUNDED'],
  FAILED: [],
  EXPIRED: [],
  REFUNDED: [],
};

export function isValidTransition(from: string, to: string): boolean {
  return (VALID_TRANSITIONS[from] ?? []).includes(to);
}

export class PaymentsService {
  /**
   * Create a Razorpay order and payment record.
   * Idempotent: same idempotencyKey returns existing record.
   */
  async createOrder(input: CreateOrderInput, tenantId?: string | null) {
    const key = input.idempotencyKey ?? uuidv4();

    // Idempotency check
    const existing = await paymentsRepository.findByIdempotencyKey(key);
    if (existing) {
      logger.info({ paymentId: existing.id, key }, 'Idempotent order create');
      return { payment: existing, created: false };
    }

    // Validate enrollment exists
    const enrollment = await prisma.enrollment.findUnique({
      where: { id: input.enrollmentId },
      select: { id: true, enrollmentId: true, tenantId: true, status: true },
    });

    if (!enrollment) {
      throw ApiError.notFound('Enrollment');
    }

    // Compute financial breakdown
    const baseAmount = input.baseAmount ?? input.amount;
    const taxAmount = input.taxAmount ?? 0;
    const discount = input.discount ?? 0;
    const finalAmount = baseAmount + taxAmount - discount;

    if (finalAmount !== input.amount) {
      // Allow mismatch — use input.amount as canonical final amount
    }

    const receipt = `rcpt_${enrollment.enrollmentId}_${Date.now()}`;
    const expiresAt = new Date(Date.now() + env.PAYMENT_TIMEOUT_MIN * 60 * 1000);

    // Create pending payment record first
    const payment = await paymentsRepository.createPayment({
      enrollmentId: input.enrollmentId,
      idempotencyKey: key,
      baseAmount,
      taxAmount,
      discount,
      finalAmount: input.amount,
      currency: input.currency ?? 'INR',
      receipt,
      expiresAt,
      tenantId: tenantId ?? enrollment.tenantId ?? null,
    });

    try {
      // Create Razorpay order
      const rzpOrder = await createRazorpayOrder(
        {
          amount: input.amount,
          currency: input.currency ?? 'INR',
          receipt,
          notes: {
            enrollmentId: enrollment.enrollmentId,
            internalPaymentId: payment.id,
            ...(input.notes ?? {}),
          },
        },
        tenantId ?? enrollment.tenantId,
      );

      // Update payment with Razorpay order ID
      const updated = await paymentsRepository.setOrderCreated(payment.id, rzpOrder.id);

      logger.info(
        {
          paymentId: payment.id,
          razorpayOrderId: rzpOrder.id,
          enrollmentId: enrollment.enrollmentId,
        },
        'Razorpay order created',
      );

      return { payment: updated, created: true, razorpayOrder: rzpOrder };
    } catch (err) {
      // Mark payment as FAILED if Razorpay order creation fails
      await paymentsRepository.markFailed(payment.id, 'GATEWAY_ERROR', String(err), 'system');
      throw ApiError.serviceUnavailable('Failed to create payment order — please try again');
    }
  }

  /**
   * Verify client-side payment signature and mark IN_PROGRESS.
   * The webhook is the authoritative success signal; this is a client-side pre-confirmation.
   */
  async verifyPayment(input: VerifyPaymentInput, tenantId?: string | null) {
    const payment = await paymentsRepository.findById(input.paymentId);
    if (!payment) {
      throw ApiError.notFound('Payment');
    }

    // Validate state allows client confirmation
    if (!['CREATED', 'PENDING', 'IN_PROGRESS'].includes(payment.status)) {
      throw ApiError.conflict(`Payment is in state ${payment.status} and cannot be confirmed`);
    }

    const isValid = await verifyPaymentSignature(
      input.razorpayOrderId,
      input.razorpayPaymentId,
      input.razorpaySignature,
      tenantId ?? payment.tenantId,
    );

    if (!isValid) {
      await paymentsRepository.markFailed(
        payment.id,
        'GATEWAY_ERROR',
        'Invalid Razorpay signature on client verification',
        'client',
      );
      throw ApiError.badRequest('Invalid payment signature');
    }

    // Mark as IN_PROGRESS — webhook will finalize
    await paymentsRepository.transitionStatus(payment.id, 'IN_PROGRESS', 'client', undefined, {
      razorpayPaymentId: input.razorpayPaymentId,
      razorpaySignature: input.razorpaySignature,
      clientConfirmedAt: new Date(),
    });

    logger.info(
      { paymentId: payment.id, razorpayPaymentId: input.razorpayPaymentId },
      'Payment client-side verified — awaiting webhook',
    );

    return { status: 'IN_PROGRESS', message: 'Payment verified — awaiting confirmation' };
  }

  /**
   * Update heartbeat for in-progress payment.
   */
  async heartbeat(input: HeartbeatInput) {
    const payment = await paymentsRepository.findById(input.paymentId);
    if (!payment) {
      throw ApiError.notFound('Payment');
    }

    await paymentsRepository.updateHeartbeat(payment.id);
    return { heartbeat: new Date().toISOString() };
  }

  /**
   * Process a refund request.
   */
  async refund(input: RefundInput, tenantId?: string | null) {
    const payment = await paymentsRepository.findById(input.paymentId);
    if (!payment) {
      throw ApiError.notFound('Payment');
    }

    if (!['SUCCESS', 'PARTIAL'].includes(payment.status)) {
      throw ApiError.conflict(`Payment status ${payment.status} cannot be refunded`);
    }

    if (!payment.razorpayPaymentId) {
      throw ApiError.conflict('No Razorpay payment ID — cannot refund');
    }

    const refundAmount = input.amount ?? payment.paidAmount;
    const isFullRefund = refundAmount >= payment.paidAmount;

    try {
      const refund = await createRazorpayRefund(
        payment.razorpayPaymentId,
        refundAmount,
        { internalPaymentId: payment.id, reason: input.reason ?? 'Requested refund' },
        tenantId ?? payment.tenantId,
      );

      await paymentsRepository.markRefunded(payment.id, refund.id, refundAmount, isFullRefund);

      logger.info(
        { paymentId: payment.id, refundId: refund.id, refundAmount },
        'Refund processed',
      );

      return { refundId: refund.id, amount: refundAmount, status: 'REFUNDED' };
    } catch (err) {
      logger.error({ err, paymentId: payment.id }, 'Refund failed');
      throw ApiError.serviceUnavailable('Refund processing failed — please try again');
    }
  }

  /**
   * Get payment status.
   */
  async getPayment(id: string) {
    const payment = await paymentsRepository.findById(id);
    if (!payment) throw ApiError.notFound('Payment');
    return payment;
  }

  /**
   * List payments with filters.
   */
  async listPayments(query: ListPaymentsQuery) {
    return paymentsRepository.list(query);
  }

  /**
   * List failed payments for admin dashboard.
   */
  async listFailedPayments(query: ListPaymentsQuery) {
    return paymentsRepository.list({ ...query, status: 'FAILED' });
  }

  // ── Cron handlers ──────────────────────────────────────────────────────────

  /**
   * Recover pending payments: find IN_PROGRESS/PENDING payments with no
   * terminal webhook that are older than 2 minutes. Call Razorpay API for
   * status and reconcile.
   *
   * Returns count of payments processed.
   */
  async recoverPendingPayments(correlationId: string): Promise<number> {
    const staleBeforeDate = new Date(Date.now() - 2 * 60 * 1000);
    const stalePayments = await paymentsRepository.findStalePayments(staleBeforeDate, [
      'IN_PROGRESS',
      'PENDING',
    ]);

    if (stalePayments.length === 0) {
      logger.debug({ correlationId }, 'recoverPendingPayments: no stale payments found');
      return 0;
    }

    logger.info(
      { correlationId, count: stalePayments.length },
      'recoverPendingPayments: starting recovery',
    );

    let recovered = 0;

    for (const payment of stalePayments) {
      try {
        if (!payment.razorpayPaymentId && !payment.razorpayOrderId) {
          // No Razorpay IDs — can't reconcile; skip
          continue;
        }

        if (payment.razorpayPaymentId) {
          const rzpPayment = await fetchRazorpayPayment(
            payment.razorpayPaymentId,
            payment.tenantId,
          );

          if (rzpPayment.status === 'captured') {
            await paymentsRepository.markSuccess(
              payment.id,
              rzpPayment.id,
              '',
              rzpPayment.amount,
            );
            recovered++;
            logger.info(
              { paymentId: payment.id, correlationId },
              'recoverPendingPayments: payment recovered as SUCCESS',
            );
          } else if (rzpPayment.status === 'failed') {
            await paymentsRepository.markFailed(
              payment.id,
              'PAYMENT_FAILED',
              `Razorpay status: ${rzpPayment.status}`,
              'cron',
            );
            recovered++;
          }
          // authorized / created → leave pending, will be reconciled later
        } else {
          // Only orderId available — increment retry; full reconciliation will pick it up
          await paymentsRepository.incrementRetry(payment.id);
        }
      } catch (err) {
        logger.error(
          { err, paymentId: payment.id, correlationId },
          'recoverPendingPayments: error processing payment',
        );
      }
    }

    logger.info(
      { correlationId, processed: stalePayments.length, recovered },
      'recoverPendingPayments: complete',
    );
    return recovered;
  }

  /**
   * Full DB-vs-Razorpay reconciliation sweep over last 24 hours.
   *
   * Finds payments that are not in a terminal state and checks their
   * Razorpay status. Updates DB accordingly.
   *
   * Returns count of reconciled payments.
   */
  async reconcileWithRazorpay(correlationId: string): Promise<number> {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const pendingPayments = await paymentsRepository.findStalePayments(since24h, [
      'INITIATED',
      'CREATED',
      'IN_PROGRESS',
      'PENDING',
    ]);

    logger.info(
      { correlationId, count: pendingPayments.length },
      'reconcileWithRazorpay: starting sweep',
    );

    let reconciled = 0;

    for (const payment of pendingPayments) {
      try {
        if (!payment.razorpayPaymentId) continue;

        const rzpPayment = await fetchRazorpayPayment(
          payment.razorpayPaymentId,
          payment.tenantId,
        );

        if (rzpPayment.status === 'captured') {
          await paymentsRepository.markSuccess(
            payment.id,
            rzpPayment.id,
            '',
            rzpPayment.amount,
          );
          reconciled++;
        } else if (rzpPayment.status === 'failed') {
          await paymentsRepository.markFailed(
            payment.id,
            'PAYMENT_FAILED',
            `Razorpay reconciliation: ${rzpPayment.error_description ?? rzpPayment.status}`,
            'cron',
          );
          reconciled++;
        }
      } catch (err) {
        logger.error(
          { err, paymentId: payment.id, correlationId },
          'reconcileWithRazorpay: error checking payment',
        );
      }
    }

    logger.info(
      { correlationId, processed: pendingPayments.length, reconciled },
      'reconcileWithRazorpay: complete',
    );
    return reconciled;
  }

  /**
   * Expire payments older than PAYMENT_TIMEOUT_MIN minutes.
   *
   * Returns count of expired payments.
   */
  async expireStalePayments(correlationId: string): Promise<number> {
    const expired = await paymentsRepository.findExpiredPayments();

    if (expired.length === 0) {
      logger.debug({ correlationId }, 'expireStalePayments: nothing to expire');
      return 0;
    }

    logger.info(
      { correlationId, count: expired.length },
      'expireStalePayments: starting expiry',
    );

    let expiredCount = 0;

    for (const payment of expired) {
      try {
        await prisma.$transaction(async (tx) => {
          const existing = await tx.payment.findUnique({
            where: { id: payment.id },
            select: { status: true },
          });

          // Guard: skip if already terminal
          if (!existing || ['SUCCESS', 'FAILED', 'EXPIRED', 'REFUNDED'].includes(existing.status)) {
            return;
          }

          await tx.payment.update({
            where: { id: payment.id },
            data: {
              status: 'EXPIRED',
              updatedAt: new Date(),
            },
          });

          await tx.paymentAuditLog.create({
            data: {
              paymentId: payment.id,
              fromStatus: existing.status,
              toStatus: 'EXPIRED',
              actor: 'cron',
              reason: 'Payment TTL exceeded',
            },
          });
        });
        expiredCount++;
      } catch (err) {
        logger.error(
          { err, paymentId: payment.id, correlationId },
          'expireStalePayments: error expiring payment',
        );
      }
    }

    logger.info(
      { correlationId, expired: expiredCount },
      'expireStalePayments: complete',
    );
    return expiredCount;
  }
}

export const paymentsService = new PaymentsService();
