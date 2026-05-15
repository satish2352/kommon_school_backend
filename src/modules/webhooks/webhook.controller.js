'use strict';

/**
 * Webhook Delivery Admin Controller
 *
 * All endpoints require admin authentication + appropriate permission.
 * No public access.
 */

const webhookService = require('./webhook.service');
const sumagoService  = require('./sumago.service');
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

// ---------------------------------------------------------------------------
// GET /api/v1/webhooks/sumago/users
// Proxies the Sumago "Retrieve User Data & Status" endpoint. The Sumago Bearer
// token lives only on the backend (env var); the frontend never sees it.
// ---------------------------------------------------------------------------

const sumagoUsers = asyncHandler(async (req, res) => {
  const data = await sumagoService.fetchUsers(req.traceId);
  sendSuccess(res, HTTP.OK, data);
});

// ---------------------------------------------------------------------------
// GET /api/v1/webhooks/sumago/config
// Returns whether Sumago is configured (URL set + token set). NEVER returns
// the token itself — used by the UI to show "configured / not configured".
// ---------------------------------------------------------------------------

const sumagoConfig = asyncHandler(async (req, res) => {
  const { base, enabled } = sumagoService.getConfig();
  sendSuccess(res, HTTP.OK, {
    enabled,
    baseUrl: base || null,
    // intentionally omit token
  });
});

module.exports = { list, getById, stats, sendTest, sumagoUsers, sumagoConfig };
