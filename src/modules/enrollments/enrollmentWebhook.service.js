'use strict';

/**
 * enrollmentWebhook.service.js
 *
 * Builds and fires the enrollment webhook payload to an external URL after a
 * successful Razorpay payment verification. All calls are non-blocking — the
 * verify endpoint never waits for or fails on webhook errors.
 *
 * URL is configurable via ENROLLMENT_WEBHOOK_URL env var; falls back to the
 * default webhook.site endpoint.
 *
 * At fire-time, the service looks up the CourseMaster row associated with the
 * enrollment's promo code (using findActivePromoCodeWithRelations) and sources
 * group, unit, phase, and amount from that row. If the lookup fails or the
 * promo code is missing/deactivated, all four fields fall back to dummy values
 * so the webhook always fires regardless of stale promo data.
 *
 * Every delivery (success or failure) is persisted to the webhook_delivery table
 * via executeWebhookDelivery. Persist failures are swallowed so they never affect
 * the payment-verify response.
 */

const logger = require('../../config/logger');
const { getPrismaClient } = require('../../config/database');
const { findActivePromoCodeWithRelations } = require('../promoCodes/promoCode.service');

const WEBHOOK_URL =
  process.env.ENROLLMENT_WEBHOOK_URL ||
  'https://webhook.site/8012a95d-2521-4b64-b59f-1cbf3bd5e6e0';

// ---------------------------------------------------------------------------
// Payload builder
// ---------------------------------------------------------------------------

/**
 * Build the webhook JSON payload from an enrollment record, payment info, and
 * an optional Course Master row.
 *
 * @param {{
 *   enrollment:        object,
 *   razorpayPaymentId: string|null,
 *   amount:            number,
 *   course:            object|null
 * }} params
 *   enrollment        — Prisma enrollment row (name, email, phone_number, promo_code, …)
 *   razorpayPaymentId — razorpay_payment_id string; falsy triggers fallback id
 *   amount            — order amount in paise (integer); used only when course is null
 *   course            — CourseMaster row with education + duration relations included;
 *                       null when promo lookup returned nothing (activates dummy fallback)
 * @returns {object} webhook payload (11 fields)
 */
function buildPayload({ enrollment, razorpayPaymentId, amount, course }) {
  // Split name on first space: "Ravi Sharma" → firstName="Ravi", lastName="Sharma"
  const rawName = enrollment?.name ?? '';
  const spaceIdx = rawName.indexOf(' ');
  const firstName = spaceIdx === -1 ? rawName : rawName.slice(0, spaceIdx);
  const lastName  = spaceIdx === -1 ? ''      : rawName.slice(spaceIdx + 1);

  // Normalise phone: prepend +91 if exactly 10 digits with no leading +
  const rawPhone = String(enrollment?.phone_number ?? '');
  const phoneNumber = /^\d{10}$/.test(rawPhone) ? `+91${rawPhone}` : rawPhone;

  // Transaction ID: use real Razorpay payment ID if available, else generate
  const transactionId =
    razorpayPaymentId ||
    `txn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // Course-derived fields — sourced from CourseMaster when available, else dummies.
  // Dummy fallback also applies per-field when the FK relation is null (e.g. a
  // course without an assigned education or duration).
  let group, unit, phase, amountRupees;
  if (course) {
    unit         = course.nameOfCourseAsGroup;
    group        = course.education?.name ?? 'group_A';
    phase        = course.duration?.label  ?? 'phase_2';
    // courseFee is a Prisma Decimal stored as rupees — coerce to integer rupees.
    // Math.round handles both string "49999.00" and numeric representations.
    amountRupees = Math.round(Number(course.courseFee));
  } else {
    // Fallback: dummy values + paise → rupees conversion (existing behavior)
    unit         = 'unit_01';
    group        = 'group_A';
    phase        = 'phase_2';
    amountRupees = Math.round((amount ?? 0) / 100);
  }

  return {
    firstName,
    lastName,
    email:         enrollment?.email ?? '',
    phoneNumber,
    plan:          'SUMAGO30',
    group,
    unit,
    phase,
    segment:       'enterprise',
    transactionId,
    amount:        amountRupees,
  };
}

// ---------------------------------------------------------------------------
// Execute + persist — shared by post-payment and admin-test paths
// ---------------------------------------------------------------------------

/**
 * Fire the webhook HTTP POST, measure duration, persist the delivery row.
 *
 * This is a reusable helper called by both:
 *   - fireEnrollmentWebhook (post-payment, source='BACKEND')
 *   - webhook.service.js sendTestWebhook (admin test, source='ADMIN_TEST')
 *
 * The persist is wrapped in its own try/catch so a DB failure never propagates
 * to the caller — the golden rule is that webhook plumbing must never break the
 * payment verify endpoint.
 *
 * @param {{
 *   enrollment: object,
 *   payload:    object,
 *   source:     string,
 *   course:     object|null
 * }} params
 * @returns {Promise<object|null>} persisted WebhookDelivery row, or null if persist failed
 */
async function executeWebhookDelivery({ enrollment, payload, source = 'BACKEND', course = null }) {
  const startMs = Date.now();
  let response    = null;
  let responseBody = null;
  let errorMessage = null;

  try {
    response = await fetch(WEBHOOK_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });

    try {
      const text = await response.text();
      // Truncate long response bodies to 4000 chars to avoid bloating the DB
      responseBody = text.length > 4000
        ? text.slice(0, 4000) + '…[truncated]'
        : text;
    } catch {
      responseBody = null;
    }
  } catch (fetchErr) {
    errorMessage = fetchErr?.message ?? String(fetchErr);
  }

  const durationMs = Date.now() - startMs;
  const ok = response?.ok === true;

  // Persist the delivery row.
  // Wrapped in its own try/catch — failure logs a warning but never throws.
  let persistedRow = null;
  try {
    const db = getPrismaClient();
    persistedRow = await db.webhookDelivery.create({
      data: {
        // Use enrollment_code (human-readable) when available; fall back to UUID
        enrollmentId:   enrollment?.enrollment_code || enrollment?.id || null,
        destinationUrl: WEBHOOK_URL,
        method:         'POST',
        // Only store non-credential headers — never store Authorization
        requestHeaders: { 'Content-Type': 'application/json' },
        requestPayload: payload,
        responseStatus: response?.status ?? null,
        responseBody,
        errorMessage,
        durationMs,
        ok,
        promoCode:    enrollment?.promo_code ?? null,
        courseMatched: course !== null,
        source,
        sentAt:       new Date(),
      },
    });
    logger.debug('webhook_delivery_persisted', {
      id:           persistedRow.id,
      ok,
      source,
      enrollmentId: persistedRow.enrollmentId,
    });
  } catch (dbErr) {
    logger.warn({
      msg:   'webhook_delivery_persist_failed',
      error: dbErr?.message ?? String(dbErr),
    });
  }

  return persistedRow;
}

// ---------------------------------------------------------------------------
// Fire function — non-blocking, never throws
// ---------------------------------------------------------------------------

/**
 * Fire the enrollment webhook after a successful payment verification.
 *
 * Uses setImmediate so the entire promo lookup + HTTP POST + persist is deferred
 * to the next event-loop tick, ensuring the payment-verify API response returns
 * to the client immediately. Errors are logged but never propagated.
 *
 * @param {{ enrollment: object, razorpayPaymentId: string|null, amount: number }} params
 */
function fireEnrollmentWebhook({ enrollment, razorpayPaymentId, amount }) {
  setImmediate(async () => {
    // Step 1: look up the CourseMaster row linked to the enrollment's promo code.
    // Wrapped in its own try/catch so a DB failure never silences the webhook.
    let course = null;
    const promoCode = enrollment?.promo_code ?? null;
    if (promoCode) {
      try {
        course = await findActivePromoCodeWithRelations(promoCode);
      } catch (lookupErr) {
        logger.warn({
          msg:           'enrollment_webhook_promo_lookup_failed',
          enrollment_id: enrollment?.id,
          promo_code:    promoCode,
          error:         lookupErr?.message ?? String(lookupErr),
        });
        // course remains null — dummy fallback applies in buildPayload
      }
    }

    // Step 2: build + execute + persist (always runs, even when course is null)
    try {
      const payload = buildPayload({ enrollment, razorpayPaymentId, amount, course });

      logger.info({
        msg:            'enrollment_webhook_firing',
        enrollment_id:  enrollment?.id,
        promo_code:     promoCode,
        course_matched: course !== null,
        url:            WEBHOOK_URL,
        transaction_id: payload.transactionId,
      });

      const persistedRow = await executeWebhookDelivery({
        enrollment,
        payload,
        source: 'BACKEND',
        course,
      });

      logger.info({
        msg:            'enrollment_webhook_fired',
        enrollment_id:  enrollment?.id,
        promo_code:     promoCode,
        course_matched: course !== null,
        webhook_status: persistedRow?.responseStatus ?? null,
        delivery_id:    persistedRow?.id ?? null,
      });
    } catch (err) {
      logger.error({
        msg:           'enrollment_webhook_error',
        enrollment_id: enrollment?.id,
        error:         err?.message ?? String(err),
      });
    }
  });
}

module.exports = { buildPayload, executeWebhookDelivery, fireEnrollmentWebhook };
