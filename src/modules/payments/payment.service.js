'use strict';

const repo = require('./payment.repository');
const enrollmentRepo = require('../enrollments/enrollment.repository');
const razorpayService = require('../razorpay/razorpay.service');
const { enqueueExternalApiSync } = require('../../queues/externalApi.queue');
const auditService = require('../audit/audit.service');
const ApiError = require('../../utils/ApiError');
const logger = require('../../config/logger');
const { ERROR_CODES, RAZORPAY_CURRENCY, HTTP } = require('../../config/constants');
const { getPrismaClient } = require('../../config/database');

/**
 * Create a Razorpay order for an existing enrollment.
 *
 * Concurrency model
 * -----------------
 * The entire flow runs inside a single Prisma interactive transaction that
 * first acquires a row-level lock (SELECT ... FOR UPDATE) on the enrollment.
 * Effect:
 *   - Two parallel POST /payment-order calls for the SAME enrollment
 *     serialize at the lock. The second one waits for the first to commit,
 *     then re-reads payments and finds the first one's freshly-inserted
 *     `initiated` row, which it reuses.
 *   - Calls for DIFFERENT enrollments are independent (each locks its own
 *     row), so throughput is not affected.
 *   - The Razorpay HTTP call happens inside the lock. This is intentional:
 *     it is the only way to guarantee that we never mint two orders for the
 *     same enrollment. Razorpay's create-order RTT is typically <1s and
 *     well within the 20s tx timeout.
 *
 * Stale-order cleanup
 * -------------------
 * On every call we list all existing payment rows for the enrollment. Any
 * row in `initiated` / `pending` that is NOT the one we're about to reuse
 * gets auto-cancelled in the same transaction. This means:
 *   - Historical duplicates from before this fix landed are cleaned up the
 *     next time the user hits create-order.
 *   - At most one ACTIVE order per enrollment exists at any time going
 *     forward, simplifying admin reconciliation and the Payments page.
 *
 * Guards (same as before, enforced inside the lock)
 *   - paid/sync_pending/completed         → 409 PAYMENT_ALREADY_COMPLETED
 *   - any Payment row in status='success' → 409 PAYMENT_ALREADY_COMPLETED
 *     (belt-and-suspenders against status drift)
 *   - no plan_pricing selected            → 400 PLAN_NOT_SELECTED
 *   - selected plan/pricing not ACTIVE    → 400 PLAN_INACTIVE / PLAN_PRICING_INACTIVE
 */
async function createOrder(enrollmentId, traceId) {
  const db = getPrismaClient();

  // Resolve the active Razorpay config BEFORE opening the transaction.
  // razorpayService.getActiveConfig() uses its own connection from the pool;
  // calling it inside the tx would force Prisma to grab a second connection,
  // which under load could deadlock the pool. The config is org-wide and
  // doesn't change per-request, so reading it ahead-of-time is safe.
  const { instance, config } = await razorpayService.getActiveConfig();

  return db.$transaction(
    async (tx) => {
      // 1. Acquire row-level lock on the enrollment. All parallel
      //    create-order calls for THIS enrollment will serialize here.
      const lockRows = await tx.$queryRaw`
        SELECT id FROM "enrollments"
        WHERE id = ${enrollmentId}::uuid AND deleted_at IS NULL
        FOR UPDATE
      `;
      if (!lockRows || lockRows.length === 0) {
        throw ApiError.notFound('Enrollment not found');
      }

      // 2. Full enrollment with plan + plan_pricing relations for the amount
      //    + receipt notes. Done inside the tx so we see any committed update
      //    from a serialized predecessor (e.g. plan re-selection).
      const enrollment = await tx.enrollment.findFirst({
        where: { id: enrollmentId, deleted_at: null },
        include: { plan_pricing: { include: { plan: true } } },
      });
      if (!enrollment) throw ApiError.notFound('Enrollment not found');

      // 3. Guard: already paid / settled. Both the enrollment.status check
      //    AND a successful Payment row check are used — status is the fast
      //    path, the Payment row is the source of truth in case status has
      //    drifted.
      if (enrollmentRepo.PAID_ENROLLMENT_STATUSES.includes(enrollment.status)) {
        throw ApiError.conflict(
          'Enrollment already has a successful payment',
          ERROR_CODES.PAYMENT_ALREADY_COMPLETED,
        );
      }
      const successCount = await tx.payment.count({
        where: { enrollment_id: enrollmentId, status: 'success' },
      });
      if (successCount > 0) {
        throw ApiError.conflict(
          'Enrollment already has a successful payment',
          ERROR_CODES.PAYMENT_ALREADY_COMPLETED,
        );
      }

      // 4. Guard: plan must be selected and ACTIVE.
      if (!enrollment.plan_pricing_id || !enrollment.plan_pricing) {
        logger.warn({
          msg:           'payment_order_plan_not_selected',
          traceId,
          enrollment_id: enrollmentId,
        });
        throw new ApiError(
          400,
          ERROR_CODES.PLAN_NOT_SELECTED,
          'A subscription plan must be selected before proceeding to payment',
        );
      }
      if (
        enrollment.plan_pricing.status !== 'ACTIVE' ||
        enrollment.plan_pricing.plan.status !== 'ACTIVE'
      ) {
        const code = enrollment.plan_pricing.plan.status !== 'ACTIVE'
          ? ERROR_CODES.PLAN_INACTIVE
          : ERROR_CODES.PLAN_PRICING_INACTIVE;
        throw new ApiError(
          400,
          code,
          'Selected plan is no longer available. Please select a different plan.',
        );
      }

      // 5. List existing payments inside the lock. This is the data we use
      //    to (a) find a reusable order and (b) identify stale rows to
      //    auto-cancel.
      const amountPaise = enrollment.amount;
      const existingPayments = await tx.payment.findMany({
        where:   { enrollment_id: enrollmentId },
        orderBy: { created_at: 'desc' },
      });

      // 6. Find reusable: any active row (initiated/pending) whose amount
      //    matches the current enrollment amount. Latest first because
      //    findMany is ordered desc by created_at.
      const activeOrders = existingPayments.filter(
        (p) => p.status === 'initiated' || p.status === 'pending',
      );
      const reusable = activeOrders.find(
        (p) => Number(p.amount) === Number(amountPaise),
      );

      // 7. Auto-cancel any active order that is NOT the reusable one.
      //    Catches:
      //      - Historical duplicates created before the lock was added
      //      - Stale orders whose amount no longer matches (plan changed)
      //      - Orphaned orders from prior failed flows
      //    Net effect: at most one ACTIVE order per enrollment at any time.
      const toCancel = activeOrders.filter((p) => !reusable || p.id !== reusable.id);
      if (toCancel.length > 0) {
        await tx.payment.updateMany({
          where: { id: { in: toCancel.map((p) => p.id) } },
          data:  { status: 'cancelled' },
        });
        logger.info({
          msg:             'payment_order_stale_active_cancelled',
          traceId,
          enrollment_id:   enrollmentId,
          cancelled_count: toCancel.length,
          cancelled_ids:   toCancel.map((p) => p.id),
        });
      }

      // 8. Reusable path: return the existing matching order.
      if (reusable) {
        logger.info({
          msg:           'payment_order_reused',
          traceId,
          enrollment_id: enrollmentId,
          payment_id:    reusable.id,
        });
        return {
          orderId:   reusable.razorpay_order_id,
          amount:    reusable.amount,
          currency:  reusable.currency,
          paymentId: reusable.id,
          keyId:     config.key_id,
        };
      }

      // 9. No reusable: call Razorpay (inside lock — see header comment)
      //    and persist the fresh payment row. The unique constraint on
      //    razorpay_order_id is the final defence: if Razorpay ever returns
      //    a duplicate id (it shouldn't) the INSERT throws P2002 and the
      //    transaction rolls back cleanly.
      const order = await razorpayService.createOrder(instance, {
        amount:   amountPaise,
        currency: RAZORPAY_CURRENCY,
        receipt:  enrollment.id,
        notes: {
          enrollmentId: enrollment.id,
          email:        enrollment.email,
          planTier:     enrollment.plan_pricing?.plan?.tier ?? null,
        },
      });

      const payment = await tx.payment.create({
        data: {
          enrollment_id:      enrollment.id,
          razorpay_order_id:  order.id,
          amount:             amountPaise,
          currency:           RAZORPAY_CURRENCY,
          status:             'initiated',
          // Edge case #15: persist razorpay_config_id so verify always uses
          // the same key set even if the active gateway is switched mid-flight.
          razorpay_config_id: config.id,
        },
      });

      // 10. Status update is idempotent — only write if it would change.
      //     Avoids spurious updated_at bumps on noisy retries.
      if (enrollment.status !== 'payment_pending') {
        await tx.enrollment.update({
          where: { id: enrollment.id },
          data:  { status: 'payment_pending' },
        });
      }

      logger.info({
        msg:           'payment_order_created',
        traceId,
        enrollment_id: enrollment.id,
        payment_id:    payment.id,
        order_id:      order.id,
      });

      return {
        orderId:   order.id,
        amount:    payment.amount,
        currency:  payment.currency,
        paymentId: payment.id,
        keyId:     config.key_id,
      };
    },
    {
      // 20s — bumped from the project-standard 15s because this transaction
      // holds the enrollment row lock during the Razorpay HTTP call. Under
      // normal Razorpay latency (~300-800ms) the lock is held <1s; the 20s
      // ceiling is a safety net against an unresponsive gateway.
      timeout: 20000,
      maxWait: 5000,
    },
  );
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
