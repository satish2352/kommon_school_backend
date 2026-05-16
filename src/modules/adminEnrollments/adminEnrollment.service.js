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
    // 0. Email uniqueness — admin manual / bulk paths reject any active
    //    enrollment for the same email, regardless of payment status:
    //      - Paid existing row     → STUDENT_ALREADY_REGISTERED (immutable)
    //      - Incomplete public row → EMAIL_ALREADY_ENROLLED (admin must
    //        resolve manually, since admin-created records skip the
    //        Razorpay flow and would orphan the prior public lead).
    //
    //    Checked inside the transaction to minimise the race window vs
    //    concurrent admin submissions and against the public website
    //    upsert path. The partial unique index in DB is the final guard
    //    if two admin requests race past this check.
    const emailLower = String(data.email || '').trim().toLowerCase();
    if (emailLower) {
      // Use lower(email) lookup to match the partial unique index and the
      // public-flow resume helper. Joi lowercases inbound emails so this is
      // belt-and-suspenders for any pre-existing mixed-case data.
      const existingRows = await tx.$queryRaw`
        SELECT id, status, enrollment_code FROM "enrollments"
        WHERE lower(email) = lower(${emailLower}) AND deleted_at IS NULL
        ORDER BY created_at DESC LIMIT 1
        FOR UPDATE
      `;
      const existingByEmail = existingRows && existingRows[0] ? existingRows[0] : null;
      if (existingByEmail) {
        const PAID = ['paid', 'sync_pending', 'completed'];
        const isPaid = PAID.includes(existingByEmail.status);
        const successfulPayments = await tx.payment.count({
          where: { enrollment_id: existingByEmail.id, status: 'success' },
        });
        const code = isPaid || successfulPayments > 0
          ? ERROR_CODES.STUDENT_ALREADY_REGISTERED
          : 'EMAIL_ALREADY_ENROLLED';
        const message = isPaid || successfulPayments > 0
          ? 'A student is already registered with this email.'
          : 'An incomplete enrollment with this email already exists. Resolve or soft-delete it before creating a new one.';
        logger.warn({
          msg: 'admin_enrollment_email_already_exists',
          traceId,
          existing_enrollment_id: existingByEmail.id,
          existing_enrollment_code: existingByEmail.enrollment_code,
          existing_status: existingByEmail.status,
          code,
        });
        throw new ApiError(409, code, message);
      }
    }

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

    // 4. Create enrollment at status='submitted', then transition to 'paid' in one update
    //    We create then update (instead of create at paid directly) so the audit trail
    //    is consistent with the normal flow shape (submitted → paid).
    const created = await tx.enrollment.create({
      data: {
        first_name,
        last_name,
        email: data.email,
        phone_number: data.phone,
        name: data.name.trim(),
        enrollment_code: enrollmentCode,
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
        status: 'submitted',
        amount: amountPaise,
        plan_pricing_id: planPricing.id,
        // Admin manual + bulk CSV are both INTERNAL by definition. The bulk
        // path also routes through createManualEnrollment per row, so this
        // single line marks both flows correctly.
        candidate_type: 'INTERNAL',
      },
    });

    // 5. Transition directly to 'paid' (skipping payment_pending + sync_pending)
    enrollment = await tx.enrollment.update({
      where: { id: created.id },
      data: { status: 'paid' },
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

module.exports = { createManualEnrollment, createBulkEnrollments };
