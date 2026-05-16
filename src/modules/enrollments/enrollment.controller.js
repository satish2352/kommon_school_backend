'use strict';

const enrollmentService = require('./enrollment.service');
const paymentService = require('../payments/payment.service');
const { fireEnrollmentWebhook } = require('./enrollmentWebhook.service');
const { sendSuccess } = require('../../utils/ApiResponse');
const asyncHandler = require('../../utils/asyncHandler');
const ApiError = require('../../utils/ApiError');
const { HTTP } = require('../../config/constants');

// ---------------------------------------------------------------------------
// Existing handlers (unchanged behaviour)
// ---------------------------------------------------------------------------

const create = asyncHandler(async (req, res) => {
  const { enrollment, created, resumed } = await enrollmentService.createEnrollment(
    req.body,
    req.traceId,
  );

  // Build response that satisfies both:
  //   - Legacy callers: all snake_case fields
  //   - Frontend (new shape): needs `id` (UUID) + `enrollmentId` (= enrollment_code)
  //   - Frontend resume UI: needs `resumed` boolean so it can render a
  //     "Welcome back" hint instead of a fresh-enrollment confirmation.
  const payload = {
    ...enrollment,
    // Alias enrollment_code as enrollmentId for the React frontend.
    // If this is a legacy enrollment, enrollment_code will be null and
    // enrollmentId will likewise be null (the frontend never calls this for legacy).
    enrollmentId: enrollment.enrollment_code || null,
    // Tri-state hint for the frontend:
    //   created=true            → brand-new enrollment
    //   resumed=true            → existing incomplete row updated with new data
    //   neither                 → dedup hit within the 5-min window
    resumed: Boolean(resumed),
  };

  const status = created ? HTTP.CREATED : HTTP.OK;
  const message = created
    ? 'Enrollment created'
    : resumed
    ? 'Resumed previous enrollment'
    : 'Existing enrollment returned';

  sendSuccess(res, status, payload, message);
});

const getById = asyncHandler(async (req, res) => {
  const enrollment = await enrollmentService.getEnrollmentById(req.params.id, req.traceId);
  sendSuccess(res, HTTP.OK, enrollment);
});

const list = asyncHandler(async (req, res) => {
  const { rows, meta } = await enrollmentService.listEnrollments(req.query, req.traceId);
  sendSuccess(res, HTTP.OK, rows, undefined, meta);
});

// ---------------------------------------------------------------------------
// Phase 3A: nested payment handlers on /:id/payment-order + /:id/payment-verify
// Both are PUBLIC (no auth required) — the public marketing enrollment flow.
// ---------------------------------------------------------------------------

/**
 * POST /api/v1/enrollments/:id/payment-order
 *
 * Creates (or reuses) a Razorpay order for the given enrollment UUID.
 * Response is reshaped to camelCase so the React PaymentModal can destructure it
 * directly without any transformation:
 *   { paymentId, razorpayOrderId, amount, currency, keyId, enrollmentId }
 */
const createPaymentOrderForEnrollment = asyncHandler(async (req, res) => {
  const enrollmentId = req.params.id;

  // Fetch the enrollment to get the enrollment_code (displayed in the modal).
  const enrollment = await enrollmentService.getEnrollmentById(enrollmentId, req.traceId);

  // Delegate to the existing payment service — unchanged behaviour.
  // Returns: { orderId, amount, currency, paymentId, keyId }
  const orderResult = await paymentService.createOrder(enrollmentId, req.traceId);

  // Reshape to camelCase that the React frontend reads.
  const payload = {
    paymentId:       orderResult.paymentId,
    razorpayOrderId: orderResult.orderId,
    amount:          orderResult.amount,
    currency:        orderResult.currency,
    keyId:           orderResult.keyId,
    // Use enrollment_code when available (new-shape), otherwise fall back to UUID.
    enrollmentId:    enrollment.enrollment_code || enrollment.id,
  };

  sendSuccess(res, HTTP.CREATED, payload, 'Order created');
});

/**
 * POST /api/v1/enrollments/:id/payment-verify
 *
 * Verifies a Razorpay payment from the public checkout flow.
 * Request body is camelCase (from the frontend); we translate to snake_case
 * before calling the existing paymentService.verifyPayment() — zero changes
 * to the service.
 *
 * Returns { status: 'success', enrollmentId } on success.
 */
const verifyPaymentForEnrollment = asyncHandler(async (req, res) => {
  const enrollmentId = req.params.id;
  const { paymentId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;

  // Load enrollment with plan_pricing relation so the webhook payload builder
  // can include the plan block. The standard getEnrollmentById does not include it.
  const { getPrismaClient } = require('../../config/database');
  const db = getPrismaClient();
  const enrollment = await db.enrollment.findFirst({
    where: { id: enrollmentId, deleted_at: null },
    include: {
      payments: { orderBy: { created_at: 'desc' }, take: 1 },
      plan_pricing: { include: { plan: true } },
    },
  });
  if (!enrollment) {
    throw ApiError.notFound('Enrollment not found');
  }

  // Translate camelCase payload to the snake_case shape the service expects.
  const snakeCaseBody = {
    razorpay_order_id:   razorpayOrderId,
    razorpay_payment_id: razorpayPaymentId,
    razorpay_signature:  razorpaySignature,
  };

  const result = await paymentService.verifyPayment(snakeCaseBody, req.traceId);

  // Fire webhook non-blocking — deferred via setImmediate so it never delays
  // the API response and never surfaces errors to the caller.
  // Only reached on successful verification (verifyPayment throws on failure).
  // enrollment now includes plan_pricing with plan for the webhook plan block.
  fireEnrollmentWebhook({
    enrollment,
    razorpayPaymentId: razorpayPaymentId,
    amount:            enrollment.amount ?? 0,
  });

  sendSuccess(res, HTTP.OK, {
    status:       'success',
    enrollmentId: enrollment.enrollment_code || enrollment.id,
    paymentId:    result.paymentId,
    alreadySettled: result.alreadySettled,
  }, 'Payment verified');
});

module.exports = {
  create,
  getById,
  list,
  createPaymentOrderForEnrollment,
  verifyPaymentForEnrollment,
};
