'use strict';

const paymentService = require('./payment.service');
const { sendSuccess } = require('../../utils/ApiResponse');
const asyncHandler = require('../../utils/asyncHandler');
const { HTTP } = require('../../config/constants');

const createOrder = asyncHandler(async (req, res) => {
  const { enrollmentId } = req.body;
  const result = await paymentService.createOrder(enrollmentId, req.traceId);
  sendSuccess(res, HTTP.CREATED, result, 'Order created');
});

const verify = asyncHandler(async (req, res) => {
  const result = await paymentService.verifyPayment(req.body, req.traceId);
  sendSuccess(res, HTTP.OK, result, 'Payment verified');
});

const getByEnrollment = asyncHandler(async (req, res) => {
  const result = await paymentService.getByEnrollment(req.params.enrollmentId);
  sendSuccess(res, HTTP.OK, result);
});

/**
 * POST /api/v1/payments/:id/retry
 * Retry a payment by payment ID.
 * Requires payments:retry permission (enforced in router).
 */
const retry = asyncHandler(async (req, res) => {
  const result = await paymentService.retryByPaymentId({
    paymentId: req.params.id,
    actor: req.user,
    traceId: req.traceId,
    req,
  });
  sendSuccess(res, HTTP.CREATED, result, 'Payment retry initiated');
});

module.exports = { createOrder, verify, getByEnrollment, retry };
