'use strict';

const { getPrismaClient } = require('../../config/database');
const razorpayService = require('./razorpay.service');
const paymentRepo = require('../payments/payment.repository');
const enrollmentRepo = require('../enrollments/enrollment.repository');
const { enqueueExternalApiSync } = require('../../queues/externalApi.queue');
const ApiError = require('../../utils/ApiError');
const asyncHandler = require('../../utils/asyncHandler');
const logger = require('../../config/logger');
const { HTTP, ERROR_CODES } = require('../../config/constants');

/**
 * Razorpay webhook handler.
 *
 * Edge case #3 (duplicate webhook events): the persisted webhook_events row
 * uses event_id as a UNIQUE key. If we see the same event_id twice we return
 * 200 immediately without reprocessing.
 *
 * Edge case #5 (verify-vs-webhook race): the actual settlement uses
 * paymentRepo.settlePayment which acquires SELECT FOR UPDATE on the payment
 * row. Whichever path lands first wins; the loser becomes a no-op.
 *
 * Webhooks ALWAYS return 200 once the signature is valid. Returning non-200
 * causes Razorpay to retry, which would amplify any transient downstream
 * failure into a storm.
 */
const handle = asyncHandler(async (req, res) => {
  const traceId = req.traceId;
  const signature = req.headers['x-razorpay-signature'];
  const rawBody = req.rawBody || '';

  if (!signature) {
    throw new ApiError(HTTP.BAD_REQUEST, ERROR_CODES.INVALID_SIGNATURE, 'Missing signature header');
  }

  const { webhookSecret } = await razorpayService.getActiveConfig();

  const ok = razorpayService.verifyWebhookSignature(rawBody, signature, webhookSecret);
  if (!ok) {
    logger.warn({ msg: 'webhook_signature_invalid', traceId });
    throw new ApiError(HTTP.UNAUTHORIZED, ERROR_CODES.INVALID_SIGNATURE, 'Invalid webhook signature');
  }

  const payload = req.body || {};
  const eventId = payload.id || payload.event_id;
  const eventType = payload.event;

  if (!eventId || !eventType) {
    throw new ApiError(HTTP.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR, 'Malformed webhook payload');
  }

  const db = getPrismaClient();

  // Edge case #3: idempotency via UNIQUE event_id. We try to insert; on
  // duplicate we return 200 and skip processing.
  let webhookRow;
  try {
    webhookRow = await db.webhookEvent.create({
      data: {
        event_id: eventId,
        event_type: eventType,
        payload,
        signature,
        processed: false,
        attempts: 0,
      },
    });
  } catch (err) {
    if (err.code === 'P2002') {
      logger.info({ msg: 'webhook_duplicate_ignored', traceId, event_id: eventId });
      return res.status(HTTP.OK).json({ success: true, data: { duplicate: true } });
    }
    throw err;
  }

  try {
    await processEvent(eventType, payload, traceId);

    await db.webhookEvent.update({
      where: { id: webhookRow.id },
      data: { processed: true, processed_at: new Date(), attempts: { increment: 1 } },
    });

    logger.info({ msg: 'webhook_processed', traceId, event_id: eventId, event_type: eventType });
    return res.status(HTTP.OK).json({ success: true, data: { processed: true } });
  } catch (err) {
    await db.webhookEvent.update({
      where: { id: webhookRow.id },
      data: { attempts: { increment: 1 } },
    });
    logger.error({
      msg: 'webhook_processing_failed',
      traceId,
      event_id: eventId,
      event_type: eventType,
      error: err.message,
    });
    // Return 200 anyway — the event is persisted and a retry sweeper (Phase 2)
    // can replay it. Returning non-200 would make Razorpay retry and pile up.
    return res.status(HTTP.OK).json({ success: true, data: { processed: false } });
  }
});

async function processEvent(eventType, payload, traceId) {
  switch (eventType) {
    case 'payment.captured':
    case 'order.paid':
      return handlePaymentSuccess(payload, traceId);
    case 'payment.failed':
      return handlePaymentFailed(payload, traceId);
    default:
      logger.info({ msg: 'webhook_event_ignored', traceId, event_type: eventType });
      return null;
  }
}

async function handlePaymentSuccess(payload, traceId) {
  const paymentEntity = payload.payload?.payment?.entity || payload.payload?.order?.entity;
  if (!paymentEntity) return;

  const orderId = paymentEntity.order_id || paymentEntity.id;
  const razorpayPaymentId = paymentEntity.id;
  const amount = paymentEntity.amount;

  const payment = await paymentRepo.findPaymentByOrderId(orderId);
  if (!payment) {
    logger.warn({ msg: 'webhook_payment_not_found', traceId, order_id: orderId });
    return;
  }

  // Edge case #5: same race-protected settle path used by /verify.
  const result = await paymentRepo.settlePayment({
    paymentId: payment.id,
    razorpayPaymentId,
    razorpaySignature: null,
    enrollmentId: payment.enrollment_id,
    expectedAmount: payment.amount,
    actualAmount: amount,
  });

  if (!result.alreadySettled) {
    // Transition enrollment to sync_pending then enqueue external sync.
    await enrollmentRepo.updateEnrollmentStatus(payment.enrollment_id, 'sync_pending');

    try {
      await enqueueExternalApiSync({
        enrollmentId: payment.enrollment_id,
        paymentId: payment.id,
        traceId,
      });
    } catch (queueErr) {
      // BullMQ/Redis unavailable. Fall back to inline fire-and-forget so the
      // external system still receives the enrollment via the webhook path.
      logger.warn({
        msg: 'external_api_enqueue_failed_webhook_using_inline_fallback',
        traceId,
        enrollment_id: payment.enrollment_id,
        payment_id: payment.id,
        error: queueErr.message,
      });
      const { syncEnrollmentInBackground } = require('../externalApi/external.service');
      syncEnrollmentInBackground({
        enrollmentId: payment.enrollment_id,
        paymentId: payment.id,
        traceId,
      });
    }
  }
}

async function handlePaymentFailed(payload, traceId) {
  const paymentEntity = payload.payload?.payment?.entity;
  if (!paymentEntity) return;

  const orderId = paymentEntity.order_id;
  const razorpayPaymentId = paymentEntity.id;

  const payment = await paymentRepo.findPaymentByOrderId(orderId);
  if (!payment) {
    logger.warn({ msg: 'webhook_payment_not_found', traceId, order_id: orderId });
    return;
  }

  if (payment.status === 'success') {
    // Already settled successfully via verify path — ignore the failure event
    return;
  }

  await paymentRepo.updatePaymentStatus(payment.id, 'failed', {
    razorpay_payment_id: razorpayPaymentId,
  });
}

/**
 * Replay a previously-persisted webhook event by re-running processEvent.
 *
 * Used by the webhookRetry cron job to retry WebhookEvent rows that failed
 * initial processing (processed=false, attempts<5). The DB row update
 * (processed flag + attempts counter) is handled by the cron — this function
 * only executes the business logic.
 *
 * @param {{ eventType: string, payload: object, traceId: string }} opts
 */
async function replayEvent({ eventType, payload, traceId }) {
  return processEvent(eventType, payload, traceId);
}

module.exports = { handle, replayEvent };
