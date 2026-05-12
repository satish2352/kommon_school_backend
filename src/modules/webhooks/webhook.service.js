'use strict';

const repo = require('./webhook.repository');
const ApiError = require('../../utils/ApiError');
const logger = require('../../config/logger');
const { buildMeta } = require('../../utils/pagination');
const { buildPayload, executeWebhookDelivery } = require('../enrollments/enrollmentWebhook.service');

// ---------------------------------------------------------------------------
// listDeliveries
// ---------------------------------------------------------------------------

/**
 * Return a paginated, optionally filtered list of webhook deliveries.
 *
 * Supported query params:
 *   page    — integer, default 1
 *   limit   — integer, default 20, max 100
 *   search  — string, case-insensitive match on enrollmentId OR promoCode
 *   status  — 'success' | 'failed' | 'error'
 *             success = ok=true
 *             failed  = ok=false AND responseStatus IS NOT NULL
 *             error   = ok=false AND responseStatus IS NULL
 *   source  — 'BACKEND' | 'ADMIN_TEST'
 *
 * @param {object} query
 * @param {string} traceId
 * @returns {Promise<{ rows: object[], meta: object }>}
 */
async function listDeliveries(query, traceId) {
  const page  = Math.max(1, parseInt(query.page,  10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
  const skip  = (page - 1) * limit;

  const where = {};

  // Search: case-insensitive match on enrollmentId OR promoCode
  if (query.search && query.search.trim()) {
    const s = query.search.trim();
    where.OR = [
      { enrollmentId: { contains: s, mode: 'insensitive' } },
      { promoCode:    { contains: s, mode: 'insensitive' } },
    ];
  }

  // Status filter
  if (query.status === 'success') {
    where.ok = true;
  } else if (query.status === 'failed') {
    where.ok = false;
    where.responseStatus = { not: null };
  } else if (query.status === 'error') {
    where.ok = false;
    where.responseStatus = null;
  }

  // Source filter
  if (query.source) {
    where.source = query.source;
  }

  const { rows, total } = await repo.findDeliveries({
    skip,
    take: limit,
    where,
    orderBy: { sentAt: 'desc' },
  });

  logger.info({ msg: 'webhook_deliveries_list', traceId, total, page, limit });

  return { rows, meta: buildMeta(page, limit, total) };
}

// ---------------------------------------------------------------------------
// getDeliveryById
// ---------------------------------------------------------------------------

/**
 * @param {number} id
 * @param {string} traceId
 * @returns {Promise<object>}
 */
async function getDeliveryById(id, traceId) {
  const delivery = await repo.findDeliveryById(id);
  if (!delivery) {
    logger.warn({ msg: 'webhook_delivery_not_found', traceId, id });
    throw ApiError.notFound('Webhook delivery not found');
  }
  return delivery;
}

// ---------------------------------------------------------------------------
// getStats
// ---------------------------------------------------------------------------

/**
 * @param {string} traceId
 * @returns {Promise<{ total, successful, failed, networkError, last24h, last7d }>}
 */
async function getStats(traceId) {
  const counts = await repo.getCounts();
  logger.info({ msg: 'webhook_stats_fetched', traceId });
  return counts;
}

// ---------------------------------------------------------------------------
// sendTestWebhook
// ---------------------------------------------------------------------------

/**
 * Fire a test webhook from the admin panel.
 *
 * Accepts the same sample shape as the frontend TEST_SAMPLES:
 *   { enrollment: { id, enrollmentId, name, email, phone }, order: { amount, currency }, rzpResponse }
 *
 * Builds payload using buildPayload with course=null (no promo lookup for test fires).
 * Persists with source='ADMIN_TEST'.
 *
 * @param {object} sample
 * @param {string} traceId
 * @returns {Promise<object>} persisted WebhookDelivery row
 */
async function sendTestWebhook(sample, traceId) {
  // Build a minimal enrollment-like object from the sample shape.
  // When planSelection is present in the sample, attach a synthetic plan_pricing
  // so that buildPayload can emit the planSelection block in the webhook payload.
  const samplePlanSelection = sample?.planSelection ?? null;
  const syntheticPlanPricing = samplePlanSelection
    ? {
        durationMonths:  samplePlanSelection.durationMonths  ?? 1,
        basePrice:       samplePlanSelection.basePrice       ?? 0,
        discountPercent: samplePlanSelection.discountPercent ?? 0,
        finalPrice:      samplePlanSelection.finalPrice      ?? 0,
        discountLabel:   samplePlanSelection.discountLabel   ?? null,
        plan: {
          id:        samplePlanSelection.id   ?? null,
          tier:      samplePlanSelection.tier ?? null,
          name:      samplePlanSelection.name ?? null,
          promoCode: samplePlanSelection.promoCode ?? null,
        },
      }
    : null;

  const enrollment = {
    id:              sample?.enrollment?.id || 'admin_test',
    enrollment_code: sample?.enrollment?.enrollmentId || null,
    name:            sample?.enrollment?.name || '',
    email:           sample?.enrollment?.email || '',
    phone_number:    sample?.enrollment?.phone || '',
    promo_code:      null,
    amount:          sample?.order?.amount ?? 0,
    plan_pricing:    syntheticPlanPricing,
  };

  const razorpayPaymentId = sample?.rzpResponse?.razorpay_payment_id || null;
  const amount = sample?.order?.amount ?? 0;

  // Build payload with course=null — test fires always use dummy course fields
  const payload = buildPayload({ enrollment, razorpayPaymentId, amount, course: null });

  logger.info({
    msg:          'webhook_test_firing',
    traceId,
    enrollmentId: enrollment.enrollment_code || enrollment.id,
  });

  const persistedRow = await executeWebhookDelivery({
    enrollment,
    payload,
    source: 'ADMIN_TEST',
    course: null,
  });

  if (!persistedRow) {
    throw ApiError.internal('Failed to persist test webhook delivery');
  }

  logger.info({
    msg:     'webhook_test_fired',
    traceId,
    id:      persistedRow.id,
    ok:      persistedRow.ok,
  });

  return persistedRow;
}

module.exports = { listDeliveries, getDeliveryById, getStats, sendTestWebhook };
