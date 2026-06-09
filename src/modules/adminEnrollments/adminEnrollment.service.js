'use strict';

const crypto = require('crypto');
const { parse: csvParse } = require('csv-parse/sync');
const { getPrismaClient } = require('../../config/database');
const ApiError = require('../../utils/ApiError');
const logger = require('../../config/logger');
const { ENROLLMENT_CODE_PREFIX, ERROR_CODES } = require('../../config/constants');
const { buildPayload, executeWebhookDelivery } = require('../enrollments/enrollmentWebhook.service');
const { manualEnrollmentSchema } = require('./adminEnrollment.validator');
const { findActivePromoCodeWithRelations } = require('../promoCodes/promoCode.service');
const { runCouponValidation } = require('../internalPlans/internalPlan.service');
const { enqueueExternalApiSync } = require('../../queues/externalApi.queue');
const auditService = require('../audit/audit.service');
const followupService = require('../followups/followup.service');

// ---------------------------------------------------------------------------
// CSV required column names (case-insensitive matching)
// ---------------------------------------------------------------------------
const REQUIRED_CSV_COLUMNS = ['name', 'email', 'phone', 'role', 'planTier', 'durationMonths'];
const ALL_CSV_COLUMNS = [
  'name', 'email', 'phone', 'role', 'education', 'readiness',
  'source', 'promoCode', 'planTier', 'durationMonths', 'notes',
];
const CSV_MAX_ROWS = 1000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateEnrollmentCode() {
  const now = new Date();
  const yy = String(now.getUTCFullYear()).slice(-2);
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const hex = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `${ENROLLMENT_CODE_PREFIX}-${yy}${mm}-${hex}`;
}

function splitName(fullName) {
  const trimmed = fullName.trim();
  const lastSpace = trimmed.lastIndexOf(' ');
  if (lastSpace === -1) {
    return { first_name: trimmed, last_name: '' };
  }
  return {
    first_name: trimmed.slice(0, lastSpace),
    last_name: trimmed.slice(lastSpace + 1),
  };
}

/**
 * Normalize CSV header names: trim + lowercase for matching.
 * Returns a mapping from normalised key -> original column name found.
 */
function buildHeaderMap(rawHeaders) {
  const map = {};
  for (const h of rawHeaders) {
    map[h.trim().toLowerCase()] = h.trim();
  }
  return map;
}

/**
 * Fire the enrollment webhook synchronously and return a delivery summary.
 * Unlike fireEnrollmentWebhook (which is async/non-blocking), this awaits
 * the delivery so the caller can include the result in the response.
 *
 * @param {{ enrollment: object, adminMeta: object }} params
 * @returns {Promise<{ ok: boolean, status: number|null, durationMs: number, error?: string }>}
 */
async function fireAdminWebhook({ enrollment, adminMeta }) {
  let course = null;
  const promoCode = enrollment?.promo_code ?? null;
  if (promoCode) {
    try {
      course = await findActivePromoCodeWithRelations(promoCode);
    } catch (lookupErr) {
      logger.warn({
        msg: 'admin_enrollment_webhook_promo_lookup_failed',
        enrollment_id: enrollment?.id,
        promo_code: promoCode,
        error: lookupErr?.message ?? String(lookupErr),
      });
    }
  }

  // Build payload with admin block merged in
  const basePayload = buildPayload({
    enrollment,
    razorpayPaymentId: null,
    amount: enrollment.amount ?? 0,
    course,
  });

  // Merge admin block into the payload; also mark rzpResponse as null/absent
  const payload = {
    ...basePayload,
    admin: adminMeta,
    rzpResponse: null,
  };

  const startMs = Date.now();
  let deliveryResult;
  try {
    deliveryResult = await executeWebhookDelivery({
      enrollment,
      payload,
      source: adminMeta.source === 'CSV' ? 'ADMIN_CSV' : 'ADMIN_MANUAL',
      course,
    });
  } catch (err) {
    const durationMs = Date.now() - startMs;
    logger.error({
      msg: 'admin_enrollment_webhook_error',
      enrollment_id: enrollment?.id,
      error: err?.message ?? String(err),
    });
    return { ok: false, status: null, durationMs, error: err?.message ?? String(err) };
  }

  return {
    ok: deliveryResult?.ok ?? false,
    status: deliveryResult?.responseStatus ?? null,
    durationMs: deliveryResult?.durationMs ?? (Date.now() - startMs),
    ...(deliveryResult?.errorMessage ? { error: deliveryResult.errorMessage } : {}),
  };
}

// ---------------------------------------------------------------------------
// triggerKommonSchoolSync
//
// Pushes an admin-created (INTERNAL) enrollment to the Kommon School Platform
// Integration API. Mirrors the BullMQ → inline-fallback pattern used by the
// public Razorpay flow at payment.service.js:315-339 so a Redis outage never
// blocks the admin response. paymentId may be null for admin flows where no
// Payment row is created (100% discount → FULLY_DISCOUNTED).
// ---------------------------------------------------------------------------
async function triggerKommonSchoolSync({ enrollmentId, paymentId, traceId }) {
  try {
    await enqueueExternalApiSync({ enrollmentId, paymentId, traceId });
  } catch (queueErr) {
    logger.warn({
      msg: 'external_api_enqueue_failed_using_inline_fallback',
      traceId,
      enrollment_id: enrollmentId,
      payment_id: paymentId,
      error: queueErr.message,
    });
    const { syncEnrollmentInBackground } = require('../externalApi/external.service');
    // Intentionally not awaited — admin response must not wait for external HTTP.
    syncEnrollmentInBackground({ enrollmentId, paymentId, traceId });
  }
}

// ---------------------------------------------------------------------------
// createManualEnrollment
// ---------------------------------------------------------------------------

/**
 * Create a single enrollment record with status=paid (skipping Razorpay),
 * then fire the webhook synchronously.
 *
 * @param {{
 *   data: object,        - validated body (manualEnrollmentSchema)
 *   actor: object,       - req.user (id, email, role)
 *   adminSource: string, - 'MANUAL' | 'CSV'
 *   traceId: string
 * }} params
 * @returns {Promise<{
 *   enrollment: { id, enrollmentCode, status, amount },
 *   webhookDelivery: { ok, status, durationMs, error? }
 * }>}
 */
async function createManualEnrollment({ data, actor, adminSource = 'MANUAL', traceId }) {
  const db = getPrismaClient();

  // ---------------------------------------------------------------------------
  // Transaction: resolve plan → create enrollment → stamp plan + paid
  // ---------------------------------------------------------------------------
  let enrollment;

  await db.$transaction(async (tx) => {
    // 0. Repeat enrollments are allowed for admin-created records: every admin
    //    submission inserts a NEW enrollment row, so a student's history
    //    accumulates instead of overwriting a prior (possibly settled) record.
    //    The public website flow still enforces one-active-per-email; that path
    //    is untouched. The DB's partial unique index only blocks a duplicate
    //    IN-PROGRESS draft, which admin rows never are (they insert at 'paid').

    // 1. Resolve planPricingId from (planTier, durationMonths)
    const planPricing = await tx.planPricing.findFirst({
      where: {
        durationMonths: data.durationMonths,
        status: 'ACTIVE',
        plan: {
          tier: data.planTier,
          status: 'ACTIVE',
        },
      },
      include: { plan: true },
    });

    if (!planPricing) {
      logger.warn({
        msg: 'admin_enrollment_plan_pricing_not_found',
        traceId,
        planTier: data.planTier,
        durationMonths: data.durationMonths,
      });
      throw new ApiError(
        404,
        ERROR_CODES.PLAN_PRICING_NOT_FOUND,
        `No active plan pricing found for tier ${data.planTier} and ${data.durationMonths} month(s)`,
      );
    }

    // Guard: parent plan must be ACTIVE (already filtered above, but explicit check)
    if (planPricing.plan.status !== 'ACTIVE') {
      throw new ApiError(400, ERROR_CODES.PLAN_INACTIVE, 'The selected plan is not active');
    }

    // 2. Compute amount in paise
    const amountPaise = Math.round(Number(planPricing.finalPrice) * 100);

    // 3. Split name for legacy fields
    const { first_name, last_name } = splitName(data.name);
    const enrollmentCode = generateEnrollmentCode();
    const promoCode = (data.promoCode || 'NEW501').trim().toUpperCase();

    // 4. Insert a fresh enrollment row directly at status='paid'. Admin records
    //    are settled at creation, so there is no submitted → paid intermediate
    //    (inserting at 'paid' also keeps clear of the one-in-progress-draft
    //    unique index). external_sync_status='PENDING' marks the row as queued
    //    for upstream push to Kommon School — same initial state the Razorpay
    //    flow sets inside settlePayment(); the worker / inline fallback flips it
    //    to SUCCESS / FAILED / DEAD_LETTER after the POST resolves.
    const enrollmentData = {
      first_name,
      last_name,
      email: data.email,
      phone_number: data.phone,
      name: data.name.trim(),
      user_role: data.role || null,
      education: data.education || null,
      readiness: data.readiness || null,
      source: data.source || null,
      promo_code: promoCode,
      plan: null,
      group: null,
      unit: null,
      phase: null,
      segment: null,
      status: 'paid',
      external_sync_status: 'PENDING',
      amount: amountPaise,
      plan_pricing_id: planPricing.id,
      enrollment_code: enrollmentCode,
      // Admin manual + bulk CSV are both INTERNAL by definition. The bulk
      // path also routes through createManualEnrollment per row, so this
      // single line marks both flows correctly.
      candidate_type: 'INTERNAL',
    };

    enrollment = await tx.enrollment.create({
      data: enrollmentData,
      include: {
        plan_pricing: {
          include: { plan: true },
        },
      },
    });

    logger.info({
      msg: 'admin_enrollment_created',
      traceId,
      enrollment_id: enrollment.id,
      enrollment_code: enrollmentCode,
      planTier: data.planTier,
      durationMonths: data.durationMonths,
      amountPaise,
      actor_id: actor?.id,
    });
  }, {
    timeout: 15000, // bumped from 5s default — remote DB latency
    maxWait: 5000,
  });

  // ---------------------------------------------------------------------------
  // Outside transaction: fire webhook synchronously
  // ---------------------------------------------------------------------------
  const adminMeta = {
    source: adminSource,
    actorId: actor?.id ?? null,
    actorEmail: actor?.email ?? null,
    ...(data.notes ? { notes: data.notes } : {}),
  };

  const webhookDelivery = await fireAdminWebhook({ enrollment, adminMeta });

  // Push the admin-created enrollment to Kommon School. No Payment row exists
  // for the legacy manual path, so paymentId is null — buildRequestBody in
  // external.service.js synthesises ADMIN_<enrollment_code> as transactionId.
  await triggerKommonSchoolSync({
    enrollmentId: enrollment.id,
    paymentId: null,
    traceId,
  });

  // Ensure a Followup row exists so the lead is visible in the admin
  // Follow-ups page and (once assigned) the employee portal. Idempotent
  // and fire-and-forget — failure here must not break enrollment creation.
  try {
    await followupService.autoCreateFromDeadLetter({
      enrollmentId: enrollment.id,
      status:       'new',
      traceId,
    });
  } catch (err) {
    logger.warn({
      msg:           'followup_auto_create_failed_admin_manual',
      traceId,
      enrollment_id: enrollment.id,
      error:         err?.message || String(err),
    });
  }

  return {
    enrollment: {
      id: enrollment.id,
      enrollmentCode: enrollment.enrollment_code,
      status: enrollment.status,
      amount: enrollment.amount,
    },
    webhookDelivery,
  };
}

// ---------------------------------------------------------------------------
// createInternalEnrollment — admin "New Enrollment" wizard, internal flow
// ---------------------------------------------------------------------------

/**
 * Create a single enrollment from the admin internal-enrollment wizard.
 *
 * Guarantees:
 *   - Pricing is read from the DB (CourseMaster.courseFee). Frontend
 *     cannot influence the final amount.
 *   - Coupon is re-validated server-side via the same runCouponValidation
 *     used by the public calculate-fee API. usageLimit IS enforced
 *     (admin policy now: reject at limit).
 *   - usedCount is atomically incremented on the InternalPlan row inside
 *     the same transaction, under SELECT ... FOR UPDATE on the
 *     internal_plans row. Two concurrent admin submissions racing for the
 *     last redemption serialize: the loser sees the limit reached and
 *     gets a 400 COUPON_USAGE_LIMIT_REACHED.
 *   - Snapshot of base / discount / final + full coupon row is persisted
 *     on the enrollment so future admin edits to the live coupons[] array
 *     do NOT rewrite history.
 *   - final === 0 (100% off) → enrollment goes straight to status='paid'
 *     with NO Payment row created (clean ledger).
 *   - final > 0 → one Payment row at status='success', synthetic
 *     razorpay_order_id of "ADMIN_MANUAL_<uuid>".
 *
 * @param {{ data, actor, adminSource?, traceId, req? }} params
 * @returns {Promise<{ enrollment, webhookDelivery }>}
 */
async function createInternalEnrollment({ data, actor, adminSource = 'INTERNAL', traceId, req }) {
  const db = getPrismaClient();
  const toPaise = (rupees) => Math.round(Number(rupees) * 100);

  // ---------------------------------------------------------------------------
  // Step 1: read-only validation BEFORE we open the tx, so a fast 4xx
  //         doesn't hold any locks.
  // ---------------------------------------------------------------------------
  const planSnapshot = await db.internalPlan.findUnique({
    where: { id: data.internalPlanId },
    include: { course: true },
  });
  if (!planSnapshot) throw new ApiError(404, 'INTERNAL_PLAN_NOT_FOUND', 'Internal plan not found.');
  if (planSnapshot.status !== 'ACTIVE') {
    throw new ApiError(400, 'INTERNAL_PLAN_INACTIVE', 'Internal plan is not active.');
  }
  if (planSnapshot.courseId !== data.courseId) {
    throw new ApiError(400, 'INTERNAL_PLAN_COURSE_MISMATCH',
      'Internal plan does not belong to the selected course.');
  }
  if (!planSnapshot.course || planSnapshot.course.courseFee == null) {
    throw new ApiError(400, 'COURSE_FEE_UNAVAILABLE', 'Course fee is not configured.');
  }
  const basePriceRupees = Number(planSnapshot.course.courseFee);
  if (!Number.isFinite(basePriceRupees) || basePriceRupees <= 0) {
    throw new ApiError(400, 'COURSE_FEE_INVALID', 'Course fee is invalid.');
  }
  const basePricePaise = toPaise(basePriceRupees);

  // ---------------------------------------------------------------------------
  // Step 2: interactive transaction with row-locks.
  //
  //   Lock #1: internal_plans row — serializes coupon usedCount updates
  //            for the same plan across concurrent admin submissions.
  //   Lock #2: enrollments-by-email row — same race-protection as the
  //            public flow (createEnrollment).
  // ---------------------------------------------------------------------------
  let enrollment;
  let createdPaymentId = null;
  let couponSnapshot   = null;
  let couponCode       = null;
  let discountAmountPaise = 0;
  let finalAmountPaise;
  let amountPaidPaiseInitial;
  let pendingPaiseInitial;
  let internalPaymentStatus;
  let persistedCouponSnapshot = null;

  await db.$transaction(async (tx) => {
    // ---- Lock #1: internal_plans row, re-read coupons under lock ----
    const lockedPlanRows = await tx.$queryRaw`
      SELECT id, coupons FROM "internal_plans"
      WHERE id = ${planSnapshot.id}::int
      FOR UPDATE
    `;
    if (!lockedPlanRows || lockedPlanRows.length === 0) {
      throw new ApiError(404, 'INTERNAL_PLAN_NOT_FOUND', 'Internal plan not found.');
    }
    const liveCoupons = Array.isArray(lockedPlanRows[0].coupons) ? lockedPlanRows[0].coupons : [];
    const livePlanForValidation = { ...planSnapshot, coupons: liveCoupons };

    // ---- Coupon validation under lock (enforces usageLimit) ----
    let discountRupees = 0;
    if (data.internalCouponCode) {
      const result = runCouponValidation({
        code: data.internalCouponCode,
        plan: livePlanForValidation,
        basePrice: basePriceRupees,
      });
      if (!result.valid) {
        // Distinct code for the usage-limit case so the frontend can
        // render a specific "limit reached" message vs a generic invalid.
        const code = result.reason === 'Coupon usage limit reached'
          ? 'COUPON_USAGE_LIMIT_REACHED'
          : 'COUPON_INVALID';
        const userMessage = code === 'COUPON_USAGE_LIMIT_REACHED'
          ? 'Coupon usage limit has been reached. Please choose another coupon or continue without one.'
          : (result.reason || 'Coupon is invalid.');
        throw new ApiError(400, code, userMessage);
      }
      couponSnapshot = result.coupon;
      couponCode     = String(couponSnapshot.code).toUpperCase();
      discountRupees = result.discountAmount;

      // ---- Atomic usedCount increment on the locked coupons JSON ----
      // We rewrite the entire coupons[] array because Postgres jsonb_set
      // with array index is fragile when the index shifts; locking the
      // row gives us safe read-modify-write semantics.
      const updatedCoupons = liveCoupons.map((c) =>
        String(c.code).toUpperCase() === couponCode
          ? { ...c, usedCount: (Number(c.usedCount) || 0) + 1 }
          : c,
      );
      await tx.internalPlan.update({
        where: { id: planSnapshot.id },
        data:  { coupons: updatedCoupons },
      });
    }

    discountAmountPaise = toPaise(discountRupees);
    finalAmountPaise    = Math.max(0, basePricePaise - discountAmountPaise);
    // Admin path collects the full final amount up-front. PARTIAL / PENDING
    // are not used (the enum keeps them only for future flexibility if a
    // record-payment UI is ever added). For every admin internal enrollment
    // the status is either FULLY_DISCOUNTED (100% off) or PAID.
    amountPaidPaiseInitial = finalAmountPaise;
    pendingPaiseInitial    = 0;
    internalPaymentStatus  =
      basePricePaise > 0 && finalAmountPaise === 0 ? 'FULLY_DISCOUNTED' : 'PAID';

    persistedCouponSnapshot = couponSnapshot
      ? {
          code:           couponCode,
          discountType:   couponSnapshot.discountType,
          discountValue:  Number(couponSnapshot.discountValue),
          expiryDate:     couponSnapshot.expiryDate || null,
          usageLimit:     couponSnapshot.usageLimit != null ? Number(couponSnapshot.usageLimit) : null,
          discount_amount_paise: discountAmountPaise,
          base_price_paise:      basePricePaise,
          final_amount_paise:    finalAmountPaise,
          snapshottedAt: new Date().toISOString(),
          snapshottedBy: actor?.email ?? null,
        }
      : null;

    // ---- Repeat enrollments allowed: always INSERT a new row ----
    // Every admin internal enrollment creates a fresh record (settled at
    // 'paid'), so a student's enrollment history accumulates per email instead
    // of overwriting a prior record. The public website flow is unchanged.

    // ---- Create the enrollment with the full snapshot ----
    const { first_name, last_name } = splitName(data.name);
    const enrollmentCode = generateEnrollmentCode();
    const enrollmentData = {
      first_name, last_name,
      email: data.email,
      phone_number: data.phone,
      name: data.name.trim(),
      user_role: data.role || null,
      education: data.education || null,
      readiness: data.readiness || null,
      source: data.source || null,
      candidate_type: 'INTERNAL',
      plan: null, group: null, unit: null, phase: null, segment: null,
      amount: finalAmountPaise,           // legacy column kept in sync with final
      promo_code: couponCode,             // legacy column
      // First-class snapshot columns:
      internal_plan_id:        planSnapshot.id,
      base_price_paise:        basePricePaise,
      discount_amount_paise:   discountAmountPaise,
      final_amount_paise:      finalAmountPaise,
      amount_paid_paise:       amountPaidPaiseInitial,
      coupon_code_snapshot:    couponCode,
      coupon_snapshot:         persistedCouponSnapshot,
      internal_payment_status: internalPaymentStatus,
      // Lifecycle: admin record is settled at creation
      status: 'paid',
      // Queue for upstream push to Kommon School — same initial state the
      // Razorpay flow sets inside settlePayment(). Flipped to SUCCESS /
      // FAILED / DEAD_LETTER by the worker after the POST resolves.
      external_sync_status: 'PENDING',
    };
    // Include internal_plan + course so the webhook builder (buildPayload in
    // enrollmentWebhook.service.js) can pull the per-entity Sumago overrides
    // (sumagoPlanCode / sumagoGroup / sumagoUnit / sumagoPhase / sumagoSegment)
    // from the freshly-written row instead of falling back to env-only defaults.
    const enrollmentInclude = { internal_plan: { include: { course: true } } };

    enrollment = await tx.enrollment.create({
      data: { ...enrollmentData, enrollment_code: enrollmentCode },
      include: enrollmentInclude,
    });

    // ---- Payment row — only when there's actually money to collect ----
    if (finalAmountPaise > 0) {
      const synthOrderId = `ADMIN_MANUAL_${crypto.randomBytes(8).toString('hex')}`;
      const payment = await tx.payment.create({
        data: {
          enrollment_id:     enrollment.id,
          razorpay_order_id: synthOrderId,
          amount:            finalAmountPaise,
          currency:          'INR',
          status:            'success',
        },
      });
      createdPaymentId = payment.id;
    }
  }, {
    timeout: 15000,
    maxWait: 5000,
  });

  // ---------------------------------------------------------------------------
  // Step 3: audit + log + webhook (post-tx).
  // ---------------------------------------------------------------------------
  try {
    await auditService.record({
      actor,
      action: 'enrollment.internal.create',
      entityType: 'enrollment',
      entityId: enrollment.id,
      changes: {
        internalPlanId:       planSnapshot.id,
        internalPlanRefId:    planSnapshot.refId,
        courseId:             planSnapshot.courseId,
        basePricePaise,
        discountAmountPaise,
        finalAmountPaise,
        couponCode,
        paymentId:            createdPaymentId,
        adminSource,
      },
      req,
    });
  } catch (auditErr) {
    logger.warn({
      msg: 'internal_enrollment_audit_failed',
      traceId,
      enrollment_id: enrollment.id,
      error: auditErr?.message ?? String(auditErr),
    });
  }

  logger.info({
    msg: 'internal_enrollment_created',
    traceId,
    enrollment_id: enrollment.id,
    enrollment_code: enrollment.enrollment_code,
    internal_plan_id: planSnapshot.id,
    base_paise: basePricePaise,
    discount_paise: discountAmountPaise,
    final_paise: finalAmountPaise,
    coupon_code: couponCode,
    payment_id: createdPaymentId,
    actor_id: actor?.id,
  });

  const adminMeta = {
    source:     adminSource,
    actorId:    actor?.id ?? null,
    actorEmail: actor?.email ?? null,
    pricing: { basePricePaise, discountAmountPaise, finalAmountPaise, couponCode },
    ...(data.notes ? { notes: data.notes } : {}),
  };
  const webhookDelivery = await fireAdminWebhook({ enrollment, adminMeta });

  // Push the admin-created internal enrollment to Kommon School. paymentId
  // is null when finalAmountPaise=0 (FULLY_DISCOUNTED — no Payment row was
  // created) — buildRequestBody falls back to ADMIN_<enrollment_code> as
  // transactionId in that case.
  await triggerKommonSchoolSync({
    enrollmentId: enrollment.id,
    paymentId: createdPaymentId,
    traceId,
  });

  // Same auto-create as the manual path — admin-created internal enrollments
  // should be follow-up-trackable from day one. Idempotent + non-fatal.
  try {
    await followupService.autoCreateFromDeadLetter({
      enrollmentId: enrollment.id,
      status:       'new',
      traceId,
    });
  } catch (err) {
    logger.warn({
      msg:           'followup_auto_create_failed_admin_internal',
      traceId,
      enrollment_id: enrollment.id,
      error:         err?.message || String(err),
    });
  }

  return {
    enrollment: {
      id:                    enrollment.id,
      enrollmentCode:        enrollment.enrollment_code,
      status:                enrollment.status,
      internalPaymentStatus,
      basePricePaise,
      discountAmountPaise,
      finalAmountPaise,
      amountPaidPaise:       amountPaidPaiseInitial,
      pendingPaise:          pendingPaiseInitial,
      couponCode,
      couponSnapshot:        persistedCouponSnapshot,
      paymentId:             createdPaymentId,
    },
    webhookDelivery,
  };
}

// ---------------------------------------------------------------------------
// createBulkEnrollments
// ---------------------------------------------------------------------------

/**
 * Parse a CSV buffer, validate rows, and call createManualEnrollment per row.
 *
 * @param {{
 *   fileBuffer: Buffer,
 *   actor: object,
 *   traceId: string
 * }} params
 * @returns {Promise<{ total, success, failed, rows }>}
 */
async function createBulkEnrollments({ fileBuffer, actor, traceId }) {
  // Parse CSV
  let records;
  try {
    records = csvParse(fileBuffer, {
      columns: true,       // first row = headers
      skip_empty_lines: true,
      trim: true,
      bom: true,           // handle UTF-8 BOM
      relax_quotes: true,
    });
  } catch (parseErr) {
    throw new ApiError(400, ERROR_CODES.CSV_INVALID_HEADERS, `CSV parse error: ${parseErr.message}`);
  }

  if (!records || records.length === 0) {
    return { total: 0, success: 0, failed: 0, rows: [] };
  }

  // Validate headers (csv-parse with columns:true exposes them via first record keys)
  const rawHeaders = Object.keys(records[0]);
  const headerMap = buildHeaderMap(rawHeaders);
  const missingRequired = REQUIRED_CSV_COLUMNS.filter(
    (col) => !(col.toLowerCase() in headerMap),
  );
  if (missingRequired.length > 0) {
    throw new ApiError(
      400,
      ERROR_CODES.CSV_INVALID_HEADERS,
      `CSV is missing required columns: ${missingRequired.join(', ')}`,
      missingRequired.map((c) => ({ field: c, message: 'Required column missing' })),
    );
  }

  // Row cap
  if (records.length > CSV_MAX_ROWS) {
    throw new ApiError(
      400,
      ERROR_CODES.CSV_TOO_LARGE,
      `CSV exceeds the maximum of ${CSV_MAX_ROWS} data rows (got ${records.length})`,
    );
  }

  /**
   * Normalise a raw CSV record into the shape expected by manualEnrollmentSchema.
   * Headers may be in any case variant, so we do a case-insensitive lookup.
   */
  function normaliseRow(rawRecord) {
    const lower = {};
    for (const [k, v] of Object.entries(rawRecord)) {
      lower[k.trim().toLowerCase()] = v;
    }
    return {
      name:           lower['name']          || undefined,
      email:          lower['email']         || undefined,
      phone:          lower['phone']         || undefined,
      role:           lower['role']          || undefined,
      education:      lower['education']     || undefined,
      readiness:      lower['readiness']     || undefined,
      source:         lower['source']        || undefined,
      promoCode:      lower['promocode']     || undefined,
      planTier:       lower['plantier']      || undefined,
      durationMonths: lower['durationmonths']
        ? Number(lower['durationmonths'])
        : undefined,
      notes:          lower['notes']         || undefined,
    };
  }

  const results = [];
  let successCount = 0;
  let failedCount = 0;

  // Process rows sequentially (webhook per row; predictable order)
  for (let i = 0; i < records.length; i++) {
    const rowIndex = i + 1;
    const normalised = normaliseRow(records[i]);

    // Validate row via Joi schema
    const { error: joiError, value: rowData } = manualEnrollmentSchema.validate(normalised, {
      abortEarly: true,
      stripUnknown: true,
    });

    if (joiError) {
      failedCount++;
      results.push({
        rowIndex,
        status: 'failed',
        error: ERROR_CODES.VALIDATION_ERROR,
        message: joiError.details[0].message,
      });
      continue;
    }

    try {
      const result = await createManualEnrollment({
        data: rowData,
        actor,
        adminSource: 'CSV',
        traceId,
      });

      successCount++;
      results.push({
        rowIndex,
        status: 'success',
        enrollmentCode: result.enrollment.enrollmentCode,
        webhookOk: result.webhookDelivery.ok,
      });
    } catch (err) {
      failedCount++;
      results.push({
        rowIndex,
        status: 'failed',
        error: err.code || ERROR_CODES.INTERNAL_ERROR,
        message: err.message,
      });
    }
  }

  return {
    total: records.length,
    success: successCount,
    failed: failedCount,
    rows: results,
  };
}

module.exports = { createManualEnrollment, createInternalEnrollment, createBulkEnrollments };
