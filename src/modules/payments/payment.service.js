'use strict';

const repo = require('./payment.repository');
const enrollmentRepo = require('../enrollments/enrollment.repository');
const razorpayService = require('../razorpay/razorpay.service');
const { enqueueExternalApiSync } = require('../../queues/externalApi.queue');
const auditService = require('../audit/audit.service');
const ApiError = require('../../utils/ApiError');
const logger = require('../../config/logger');
const { ERROR_CODES, RAZORPAY_CURRENCY } = require('../../config/constants');

/**
 * Create a Razorpay order for an existing enrollment.
 *
 * Edge case #4 (duplicate payment from double-click): a UNIQUE constraint on
 * payments.razorpay_order_id prevents two parallel orders from being persisted.
 * If the enrollment already has an `initiated` payment that has not been
 * cancelled or expired, return the existing order details so the frontend can
 * resume checkout instead of creating a parallel order.
 */
async function createOrder(enrollmentId, traceId) {
  const enrollment = await enrollmentRepo.findEnrollmentById(enrollmentId);
  if (!enrollment) throw ApiError.notFound('Enrollment not found');

  // Edge case #14: do not create a new order on an already-completed enrollment
  if (enrollment.status === 'paid' || enrollment.status === 'completed') {
    throw ApiError.conflict(
      'Enrollment already has a successful payment',
      ERROR_CODES.PAYMENT_ALREADY_COMPLETED,
    );
  }

  const existingPayments = await repo.findPaymentsByEnrollmentId(enrollmentId);
  const reusable = existingPayments.find((p) => p.status === 'initiated' || p.status === 'pending');
  if (reusable) {
    logger.info({
      msg: 'payment_order_reused',
      traceId,
      enrollment_id: enrollmentId,
      payment_id: reusable.id,
    });
    return {
      orderId: reusable.razorpay_order_id,
      amount: reusable.amount,
      currency: reusable.currency,
      paymentId: reusable.id,
      keyId: (await razorpayService.getActiveConfig()).config.key_id,
    };
  }

  const { instance, config } = await razorpayService.getActiveConfig();

  const order = await razorpayService.createOrder(instance, {
    amount: enrollment.amount,
    currency: RAZORPAY_CURRENCY,
    receipt: enrollment.id,
    notes: {
      enrollmentId: enrollment.id,
      email: enrollment.email,
      plan: enrollment.plan,
    },
  });

  // Edge case #15: persist razorpay_config_id so verify always uses the same
  // key set even if the active gateway is switched mid-flight.
  const payment = await repo.createPayment({
    enrollment_id: enrollment.id,
    razorpay_order_id: order.id,
    amount: enrollment.amount,
    currency: RAZORPAY_CURRENCY,
    status: 'initiated',
    razorpay_config_id: config.id,
  });

  await enrollmentRepo.updateEnrollmentStatus(enrollment.id, 'payment_pending');

  logger.info({
    msg: 'payment_order_created',
    traceId,
    enrollment_id: enrollment.id,
    payment_id: payment.id,
    order_id: order.id,
  });

  return {
    orderId: order.id,
    amount: payment.amount,
    currency: payment.currency,
    paymentId: payment.id,
    keyId: config.key_id,
  };
}

/**
 * Verify a Razorpay payment after the frontend checkout flow returns.
 *
 * Edge case #5 (verify-vs-webhook race): repo.settlePayment runs inside a
 * Prisma $transaction with SELECT FOR UPDATE on the payment row, so whichever
 * path lands first wins and the loser becomes a no-op.
 *
 * Edge case #15: signature is verified using the key set that was active when
 * the order was created, looked up via payment.razorpay_config_id.
 */
async function verifyPayment(body, traceId) {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = body;

  const payment = await repo.findPaymentByOrderId(razorpay_order_id);
  if (!payment) throw ApiError.notFound('Payment record not found for order');

  if (!payment.razorpay_config_id) {
    throw ApiError.internal('Payment has no associated Razorpay configuration');
  }

  const { keySecret } = await razorpayService.getConfigById(payment.razorpay_config_id);

  const ok = razorpayService.verifyPaymentSignature(
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
    keySecret,
  );

  if (!ok) {
    logger.warn({
      msg: 'payment_signature_invalid',
      traceId,
      payment_id: payment.id,
      order_id: razorpay_order_id,
    });
    await repo.updatePaymentStatus(payment.id, 'failed', { razorpay_payment_id });
    throw new ApiError(400, ERROR_CODES.INVALID_SIGNATURE, 'Invalid payment signature');
  }

  try {
    const result = await repo.settlePayment({
      paymentId: payment.id,
      razorpayPaymentId: razorpay_payment_id,
      razorpaySignature: razorpay_signature,
      enrollmentId: payment.enrollment_id,
      expectedAmount: payment.amount,
      actualAmount: payment.amount,
    });

    logger.info({
      msg: result.alreadySettled ? 'payment_already_settled' : 'payment_verified',
      traceId,
      payment_id: payment.id,
      enrollment_id: payment.enrollment_id,
    });

    if (!result.alreadySettled) {
      // Transition enrollment to sync_pending before enqueuing so the queue
      // worker always sees a consistent status even if it picks up the job
      // before the HTTP response returns to the client.
      await enrollmentRepo.updateEnrollmentStatus(payment.enrollment_id, 'sync_pending');

      try {
        await enqueueExternalApiSync({
          enrollmentId: payment.enrollment_id,
          paymentId: payment.id,
          traceId,
        });
      } catch (queueErr) {
        // BullMQ/Redis unavailable. Fall back to a direct fire-and-forget HTTP
        // call so the external system still receives the enrollment. Errors
        // inside syncEnrollmentInBackground are logged, never propagated.
        logger.warn({
          msg: 'external_api_enqueue_failed_using_inline_fallback',
          traceId,
          enrollment_id: payment.enrollment_id,
          payment_id: payment.id,
          error: queueErr.message,
        });
        const { syncEnrollmentInBackground } = require('../externalApi/external.service');
        // Intentionally not awaited — verify must not wait for external HTTP.
        syncEnrollmentInBackground({
          enrollmentId: payment.enrollment_id,
          paymentId: payment.id,
          traceId,
        });
      }
    }

    return {
      paymentId: payment.id,
      enrollmentId: payment.enrollment_id,
      status: 'success',
      alreadySettled: result.alreadySettled,
    };
  } catch (err) {
    if (typeof err.message === 'string' && err.message.startsWith('AMOUNT_MISMATCH')) {
      logger.warn({
        msg: 'payment_amount_mismatch',
        traceId,
        payment_id: payment.id,
        detail: err.message,
      });
      throw new ApiError(
        400,
        ERROR_CODES.PAYMENT_AMOUNT_MISMATCH,
        'Payment amount does not match expected amount',
      );
    }
    throw err;
  }
}

/**
 * Look up the latest payment state for an enrollment so the frontend can
 * resume the checkout flow after a page refresh (edge case #6).
 */
async function getByEnrollment(enrollmentId) {
  const enrollment = await enrollmentRepo.findEnrollmentById(enrollmentId);
  if (!enrollment) throw ApiError.notFound('Enrollment not found');

  const payments = await repo.findPaymentsByEnrollmentId(enrollmentId);
  const latest = payments[0] || null;

  return {
    enrollmentId,
    enrollmentStatus: enrollment.status,
    latestPayment: latest
      ? {
          id: latest.id,
          orderId: latest.razorpay_order_id,
          status: latest.status,
          amount: latest.amount,
          currency: latest.currency,
          createdAt: latest.created_at,
        }
      : null,
    payments: payments.map((p) => ({
      id: p.id,
      orderId: p.razorpay_order_id,
      status: p.status,
      amount: p.amount,
      createdAt: p.created_at,
    })),
  };
}

/**
 * Retry payment by payment ID.
 *
 * Loads the payment and its enrollment, guards against already-completed
 * enrollments, mints a new Razorpay order, and emits an audit event.
 *
 * This is a payment-scoped alias to the createOrder flow, intended for the
 * POST /api/v1/payments/:id/retry endpoint used by marketing and admins with
 * the payments:retry permission.
 *
 * @param {{ paymentId: string, actor: object, traceId: string, req: object }} opts
 * @returns {Promise<object>} Razorpay order details
 */
async function retryByPaymentId({ paymentId, actor, traceId, req }) {
  const payment = await repo.findPaymentById(paymentId);
  if (!payment) {
    throw ApiError.notFound('Payment not found');
  }

  const enrollment = await enrollmentRepo.findEnrollmentById(payment.enrollment_id);
  if (!enrollment) {
    throw ApiError.notFound('Associated enrollment not found');
  }

  if (enrollment.status === 'paid' || enrollment.status === 'completed') {
    throw new ApiError(
      409,
      ERROR_CODES.PAYMENT_ALREADY_COMPLETED,
      'Enrollment already has a successful payment; retry is not applicable',
    );
  }

  const orderDetails = await createOrder(enrollment.id, traceId);

  logger.info({
    msg: 'payment_retry_by_id',
    traceId,
    payment_id: paymentId,
    enrollment_id: enrollment.id,
    new_order_id: orderDetails.orderId,
    actor_id: actor && actor.id,
  });

  await auditService.record({
    actor,
    action: 'payment.retry',
    entityType: 'payment',
    entityId: paymentId,
    changes: { newOrderId: orderDetails.orderId, enrollmentId: enrollment.id },
    req,
  });

  return orderDetails;
}

module.exports = { createOrder, verifyPayment, getByEnrollment, retryByPaymentId };
