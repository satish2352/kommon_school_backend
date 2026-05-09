'use strict';

/**
 * Webhook Delivery Admin Controller
 *
 * All endpoints require admin authentication + appropriate permission.
 * No public access.
 */

const webhookService = require('./webhook.service');
const { sendSuccess } = require('../../utils/ApiResponse');
const asyncHandler = require('../../utils/asyncHandler');
const { HTTP } = require('../../config/constants');

// ---------------------------------------------------------------------------
// GET /api/v1/webhooks/deliveries
// ---------------------------------------------------------------------------

const list = asyncHandler(async (req, res) => {
  const { rows, meta } = await webhookService.listDeliveries(req.query, req.traceId);
  sendSuccess(res, HTTP.OK, rows, undefined, meta);
});

// ---------------------------------------------------------------------------
// GET /api/v1/webhooks/deliveries/:id
// ---------------------------------------------------------------------------

const getById = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const delivery = await webhookService.getDeliveryById(id, req.traceId);
  sendSuccess(res, HTTP.OK, delivery);
});

// ---------------------------------------------------------------------------
// GET /api/v1/webhooks/stats
// ---------------------------------------------------------------------------

const stats = asyncHandler(async (req, res) => {
  const counts = await webhookService.getStats(req.traceId);
  sendSuccess(res, HTTP.OK, counts);
});

// ---------------------------------------------------------------------------
// POST /api/v1/webhooks/test
// ---------------------------------------------------------------------------

const sendTest = asyncHandler(async (req, res) => {
  const delivery = await webhookService.sendTestWebhook(req.body, req.traceId);
  sendSuccess(res, HTTP.CREATED, delivery, 'Test webhook sent');
});

module.exports = { list, getById, stats, sendTest };
