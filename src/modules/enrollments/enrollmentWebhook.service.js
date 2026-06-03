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

// ---------------------------------------------------------------------------
// Destination resolution
// ---------------------------------------------------------------------------
// Priority order:
//   1. SUMAGO_API_BASE_URL → POST <base>/integrations/provision-user with Bearer auth
//   2. ENROLLMENT_WEBHOOK_URL → POST plain JSON, no auth (legacy)
//   3. webhook.site fallback (dev/testing)
//
// Sumago path is preferred when both vars are present, since SUMAGO_API_TOKEN
// adds authentication that ENROLLMENT_WEBHOOK_URL never had.
// ---------------------------------------------------------------------------
const SUMAGO_BASE  = (process.env.SUMAGO_API_BASE_URL || '').replace(/\/$/, '');
const SUMAGO_TOKEN =  process.env.SUMAGO_API_TOKEN || '';
const SUMAGO_ENABLED = Boolean(SUMAGO_BASE && SUMAGO_TOKEN);

const WEBHOOK_URL = SUMAGO_ENABLED
  ? `${SUMAGO_BASE}/integrations/provision-user`
  : (process.env.ENROLLMENT_WEBHOOK_URL ||
     'https://webhook.site/8012a95d-2521-4b64-b59f-1cbf3bd5e6e0');

// Per-delivery HTTP timeout in milliseconds.
// Prevents a slow webhook target from hanging indefinitely.
// Override via WEBHOOK_DELIVERY_TIMEOUT_MS env var (parsed as integer).
const WEBHOOK_DELIVERY_TIMEOUT_MS =
  parseInt(process.env.WEBHOOK_DELIVERY_TIMEOUT_MS, 10) || 10000;

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

  // Sumago taxonomy — three-tier resolution per field:
  //   1. Per-entity override if present (InternalPlan.sumagoPlanCode for
  //      `plan`; CourseMaster.sumagoGroup/Unit/Phase/Segment for the
  //      taxonomy quartet). These columns are admin-editable and let
  //      different plans / courses map to different Sumago entries.
  //   2. Env-var default (SUMAGO_PLAN_CODE / SUMAGO_GROUP / ...). Useful
  //      as the "house style" fallback so every plan/course doesn't need
  //      its overrides set explicitly.
  //   3. Hardcoded sane defaults so the payload is never null even when
  //      neither override nor env is set.
  //
  // Override sources:
  //   - enrollment.internal_plan        → admin-internal flow (when the
  //                                       caller includes the relation).
  //   - course                          → public-website flow (already
  //                                       fetched via promo-code lookup
  //                                       in the caller).
  //   - enrollment.internal_plan.course → admin-internal flow with course
  //                                       relation included.
  const internalPlan = enrollment?.internal_plan ?? null;
  const courseFromInternal = internalPlan?.course ?? null;
  const effectiveCourse = course ?? courseFromInternal;

  // Per-plan external Plan ID — drives BOTH the new `planId` field AND the
  // legacy `plan` field in the payload (admin requested unified behavior:
  // plan === planId so downstream Sumago uses the dynamic, per-plan code).
  //   - admin-internal flow → InternalPlan.externalPlanId
  //   - public website flow → PlanPricing.externalPlanId (when the
  //     plan_pricing relation is included by the caller)
  // Falls back to null when neither is present; receiver decides what to do.
  const planId =
    internalPlan?.externalPlanId
    || enrollment?.plan_pricing?.externalPlanId
    || null;

  // `plan` resolution — three-tier:
  //   1. Per-plan externalPlanId (new dynamic source — what admin wants today)
  //   2. Legacy per-plan sumagoPlanCode override (kept for backward compat)
  //   3. Env default → hardcoded fallback
  const planCode =
    planId
    || internalPlan?.sumagoPlanCode
    || process.env.SUMAGO_PLAN_CODE
    || 'SUMAGOTEST_30';

  // `group` resolution — admin wants the selected Course's actual name
  // ("Data Analytics Using Python", etc.) to flow through dynamically.
  // Per-course sumagoGroup override stays as the highest-priority option so
  // admins who explicitly mapped a course to a different Sumago entry still
  // win, but the natural course name takes precedence over env defaults.
  const group =
    effectiveCourse?.sumagoGroup
    || effectiveCourse?.nameOfCourseAsGroup
    || process.env.SUMAGO_GROUP
    || 'Full Stack Development Using Python';
  const unit =
    effectiveCourse?.sumagoUnit
    || process.env.SUMAGO_UNIT
    || '30 Days';
  const phase =
    effectiveCourse?.sumagoPhase
    || process.env.SUMAGO_PHASE
    || '';
  const segment =
    effectiveCourse?.sumagoSegment
    || process.env.SUMAGO_SEGMENT
    || '';

  let amountRupees;
  // Prefer the enrollment's snapshot final amount (admin-internal flow
  // populates this with the final, post-discount, post-coupon amount).
  if (enrollment?.final_amount_paise != null) {
    amountRupees = Math.round(Number(enrollment.final_amount_paise) / 100);
  } else if (effectiveCourse && effectiveCourse.courseFee != null) {
    // Public-website flow — use the matched CourseMaster's fee.
    amountRupees = Math.round(Number(effectiveCourse.courseFee));
  } else {
    // No matched course / snapshot → fall back to the order amount.
    amountRupees = Math.round((amount ?? 0) / 100);
  }

  // Webhook payload. The 11-key set below is the legacy contract; `planId`
  // is the new per-plan external identifier added alongside it. Downstream
  // consumers should be coordinated with before adding any further keys.
  return {
    firstName,
    lastName,
    email:         enrollment?.email ?? '',
    phoneNumber,
    plan:          planCode,
    planId,
    group,
    unit,
    phase,
    segment,
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

  const controller = new AbortController();
  // Abort the fetch after WEBHOOK_DELIVERY_TIMEOUT_MS to avoid hanging on slow targets
  const timeoutId = setTimeout(() => controller.abort(), WEBHOOK_DELIVERY_TIMEOUT_MS);

  // Build headers. Authorization is included only when Sumago is configured;
  // the legacy webhook target has no auth requirement.
  const fetchHeaders = { 'Content-Type': 'application/json' };
  if (SUMAGO_ENABLED) {
    fetchHeaders.Authorization = `Bearer ${SUMAGO_TOKEN}`;
  }

  try {
    response = await fetch(WEBHOOK_URL, {
      method:  'POST',
      headers: fetchHeaders,
      body:    JSON.stringify(payload),
      signal:  controller.signal,
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
    // AbortError means our timeout fired; record it as 'TIMEOUT' for clarity
    errorMessage = fetchErr?.name === 'AbortError'
      ? 'TIMEOUT'
      : (fetchErr?.message ?? String(fetchErr));
  } finally {
    clearTimeout(timeoutId);
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
