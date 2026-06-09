'use strict';

const followupService = require('./followup.service');
const { sendSuccess } = require('../../utils/ApiResponse');
const asyncHandler = require('../../utils/asyncHandler');
const { HTTP } = require('../../config/constants');

/**
 * GET /api/v1/followups
 * List followups with pagination, search, filters.
 */
const list = asyncHandler(async (req, res) => {
  const { rows, meta } = await followupService.listFollowups(
    req.query,
    req.traceId,
    req.user?.id ?? null,
  );
  sendSuccess(res, HTTP.OK, rows, undefined, meta);
});

/**
 * GET /api/v1/followups/:id/timeline
 * Return a followup with its synthesized timeline (notes + payment events).
 */
const getTimeline = asyncHandler(async (req, res) => {
  const result = await followupService.getFollowupTimeline(req.params.id, req.traceId);
  sendSuccess(res, HTTP.OK, result);
});

/**
 * POST /api/v1/followups/:id/notes
 * Append a user-authored note to the followup.
 */
const addNote = asyncHandler(async (req, res) => {
  const note = await followupService.addNote({
    followupId: req.params.id,
    authorId: req.user.id,
    body: req.body.body,
    metadata: req.body.metadata,
    traceId: req.traceId,
  });
  sendSuccess(res, HTTP.CREATED, note, 'Note added');
});

/**
 * PATCH /api/v1/followups/:id/status
 * Transition a followup to a new status, optionally updating next_followup_date.
 */
const updateStatus = asyncHandler(async (req, res) => {
  const updated = await followupService.updateStatus({
    followupId: req.params.id,
    newStatus: req.body.status,
    actorId: req.user.id,
    traceId: req.traceId,
    nextFollowupDate: req.body.next_followup_date
      ? new Date(req.body.next_followup_date)
      : undefined,
    req,
  });
  sendSuccess(res, HTTP.OK, updated, 'Status updated');
});

/**
 * POST /api/v1/followups/:id/retry-payment
 * Trigger a Razorpay payment retry for the enrollment linked to this followup.
 * Returns order details so the marketing UI can present a checkout link.
 */
const retryPayment = asyncHandler(async (req, res) => {
  const orderDetails = await followupService.triggerPaymentRetry({
    followupId: req.params.id,
    actorId: req.user.id,
    traceId: req.traceId,
    req,
  });
  sendSuccess(res, HTTP.OK, orderDetails, 'Payment retry initiated');
});

module.exports = { list, getTimeline, addNote, updateStatus, retryPayment };
