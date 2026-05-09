'use strict';

/**
 * Payment Reconciliation Job
 * Schedule: every 5 minutes (cron string lives in src/jobs/index.js)
 *
 * Finds Payment rows stuck in `pending` or `initiated` that are older than
 * RECONCILIATION_PENDING_GRACE_MS (default 10 min) and checks Razorpay
 * to determine the true payment state:
 *
 *   - Captured on Razorpay → settle + transition enrollment → enqueue sync
 *   - No capture and older than RECONCILIATION_EXPIRE_AFTER_MS (30 min) → expire
 *   - No capture but still within the expiry window → leave for next run
 *
 * Returns { processed, settled, expired, errors } for structured job logging.
 */

const { getPrismaClient } = require('../config/database');
const razorpayService = require('../modules/razorpay/razorpay.service');
const paymentRepo = require('../modules/payments/payment.repository');
const enrollmentRepo = require('../modules/enrollments/enrollment.repository');
const { enqueueExternalApiSync } = require('../queues/externalApi.queue');
const logger = require('../config/logger');

// How old a pending payment must be before we check Razorpay (10 min default)
const PENDING_GRACE_MS = parseInt(process.env.RECONCILIATION_PENDING_GRACE_MS || '600000', 10);

// How old a pending payment must be before we mark it expired (30 min default)
const EXPIRE_AFTER_MS = parseInt(process.env.RECONCILIATION_EXPIRE_AFTER_MS || '1800000', 10);

async function run() {
  const db = getPrismaClient();
  const now = new Date();
  const graceThreshold = new Date(now.getTime() - PENDING_GRACE_MS);
  const expireThreshold = new Date(now.getTime() - EXPIRE_AFTER_MS);

  // Fetch payments that are stuck — limit to 100 per run to bound execution time
  const stalePaments = await db.payment.findMany({
    where: {
      status: { in: ['pending', 'initiated'] },
      created_at: { lt: graceThreshold },
    },
    orderBy: { created_at: 'asc' },
    take: 100,
  });

  const counts = { processed: 0, settled: 0, expired: 0, errors: 0 };

  for (const payment of stalePaments) {
    counts.processed++;
    const traceId = `recon:${payment.id}`;

    try {
      const captured = await razorpayService.fetchRazorpayPayment(payment.razorpay_order_id);

      if (captured) {
        // Razorpay shows a captured payment — settle it using the same race-protected path
        const result = await paymentRepo.settlePayment({
          paymentId: payment.id,
          razorpayPaymentId: captured.id,
          razorpaySignature: null,
          enrollmentId: payment.enrollment_id,
          expectedAmount: payment.amount,
          actualAmount: captured.amount,
        });

        if (!result.alreadySettled) {
          // Transition enrollment and enqueue external sync
          await enrollmentRepo.updateEnrollmentStatus(payment.enrollment_id, 'sync_pending');

          try {
            await enqueueExternalApiSync({
              enrollmentId: payment.enrollment_id,
              paymentId: payment.id,
              traceId,
            });
          } catch (queueErr) {
            // Non-fatal — Phase 2B externalApiRetry sweeper will catch the missed enqueue
            logger.error({
              msg: 'reconciliation_enqueue_failed',
              traceId,
              payment_id: payment.id,
              enrollment_id: payment.enrollment_id,
              error: queueErr.message,
            });
          }

          logger.info({
            msg: 'reconciliation_payment_settled',
            traceId,
            payment_id: payment.id,
            razorpay_payment_id: captured.id,
          });
          counts.settled++;
        }
        // If alreadySettled we still count as processed but not settled (idempotent)
        continue;
      }

      // No captured payment from Razorpay
      if (payment.created_at < expireThreshold) {
        // Older than expiry window — mark expired
        await paymentRepo.updatePaymentStatus(payment.id, 'expired', {});
        logger.info({
          msg: 'reconciliation_payment_expired',
          traceId,
          payment_id: payment.id,
          order_id: payment.razorpay_order_id,
          age_ms: now.getTime() - payment.created_at.getTime(),
        });
        counts.expired++;
      }
      // else: within expiry window with no capture → leave for next run
    } catch (err) {
      counts.errors++;
      logger.error({
        msg: 'reconciliation_payment_error',
        traceId,
        payment_id: payment.id,
        error: err.message,
      });
    }
  }

  return counts;
}

module.exports = { run };
