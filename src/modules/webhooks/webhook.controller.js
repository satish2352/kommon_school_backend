'use strict';

/**
 * Webhook Delivery Admin Controller
 *
 * All endpoints require admin authentication + appropriate permission.
 * No public access.
 */

const webhookService      = require('./webhook.service');
const sumagoService       = require('./sumago.service');
const sumagoUserSyncSvc   = require('./sumagoUserSync.service');
const logger              = require('../../config/logger');
const { sendSuccess }     = require('../../utils/ApiResponse');
const asyncHandler        = require('../../utils/asyncHandler');
const { HTTP }            = require('../../config/constants');

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
//
// Two-phase flow:
//   1. Sync from Sumago into our local sumago_users mirror table
//      (best-effort — if Sumago is down we still return whatever we
//      already have locally).
//   2. Read from the local mirror + enrich with our enrollments join.
//
// This is the ONLY endpoint the frontend uses; the old "press a button
// to fetch" UX has been replaced by auto-load on page mount.
// ---------------------------------------------------------------------------

const sumagoUsers = asyncHandler(async (req, res) => {
  let syncResult = null;
  let syncError  = null;

  // Sync from Sumago ONLY on page 1 with no filters/search — the typical
  // "page just loaded" hit. Subsequent page-navigation requests skip the
  // upstream call entirely and serve straight from the mirror. This is
  // what keeps the table responsive at millions of rows: a click on
  // "Next page" never blocks on Sumago latency. Admins who want to force
  // a resync use the Refresh button, which the frontend signals by
  // including `?sync=force`.
  const isFirstPageNoFilter =
    Number(req.query.page) === 1 &&
    !req.query.search &&
    !req.query.onboardingStatus &&
    !req.query.candidateType;
  const forceSync = req.query.sync === 'force';

  if (isFirstPageNoFilter || forceSync) {
    try {
      syncResult = await sumagoUserSyncSvc.syncFromSumago(req.traceId);
    } catch (err) {
      // Sync failure is non-fatal — we still return the local mirror so
      // the page works in degraded mode. The error is reported back in
      // the `sync` envelope so the UI can surface it as a banner.
      syncError = {
        code:    err?.code    || err?.errorCode || 'SUMAGO_SYNC_FAILED',
        message: err?.message || 'Failed to sync from Sumago. Showing last known data.',
        status:  err?.statusCode || err?.status || 502,
      };
      logger.warn({
        msg:     'sumago_sync_soft_failed',
        traceId: req.traceId,
        error:   syncError,
      });
    }
  }

  const data = await sumagoUserSyncSvc.listFromDb(req.query, req.traceId);

  // Hoist `meta` to the top-level response envelope so it sits next to
  // `data` in the standard `{ success, data, meta }` shape the frontend
  // already understands for listDeliveries. Also keep a `sync` envelope
  // on `data` so the UI can show "Last synced 2s ago" / degraded-mode.
  const { meta, ...payload } = data;
  payload.sync = (syncResult || syncError)
    ? (syncResult
        ? { ok: true,  ...syncResult, at: new Date().toISOString() }
        : { ok: false, error: syncError, at: new Date().toISOString() })
    : { ok: true, skipped: true, reason: 'pagination_only', at: new Date().toISOString() };

  sendSuccess(res, HTTP.OK, payload, undefined, meta);
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
