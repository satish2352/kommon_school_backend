'use strict';

const crypto = require('crypto');
const repo = require('./enrollment.repository');
const ApiError = require('../../utils/ApiError');
const logger = require('../../config/logger');
const { findActivePromoCode } = require('../promoCodes/promoCode.service');
const { parsePagination, buildMeta } = require('../../utils/pagination');
const { getPrismaClient } = require('../../config/database');
const {
  DEFAULT_ENROLLMENT_AMOUNT_PAISE,
  ENROLLMENT_CODE_PREFIX,
  ERROR_CODES,
} = require('../../config/constants');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Detect which payload shape was submitted.
 * New shape has `name` + `phone`; legacy shape has `first_name` + `phone_number`.
 *
 * @param {object} body — validated request body (either shape)
 * @returns {boolean}
 */
function isNewShape(body) {
  return typeof body.name === 'string' && typeof body.phone === 'string';
}

/**
 * Split a full name on the LAST space.
 * "Priya Sharma"  => { first_name: "Priya", last_name: "Sharma" }
 * "Priya"         => { first_name: "Priya", last_name: "" }
 * "Dr Priya Sharma" => { first_name: "Dr Priya", last_name: "Sharma" }
 *
 * @param {string} fullName
 * @returns {{ first_name: string, last_name: string }}
 */
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
 * Generate a human-friendly enrollment code.
 * Format: KS-YYMM-XXXXXX  (e.g. KS-2605-A1B2C3)
 *
 * @returns {string}
 */
function generateEnrollmentCode() {
  const now = new Date();
  const yy = String(now.getUTCFullYear()).slice(-2);
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const hex = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `${ENROLLMENT_CODE_PREFIX}-${yy}${mm}-${hex}`;
}

function maskEmail(email) {
  const [local, domain] = email.split('@');
  return `${local[0]}***@${domain}`;
}

// ---------------------------------------------------------------------------
// createEnrollment — handles both legacy + new payload shapes
//
// Production-ready upsert/resume flow:
//
//   1. Validate (promo code re-check etc.) BEFORE opening any transaction so
//      transient validation failures don't hold a DB lock open.
//   2. Open an interactive transaction and SELECT ... FOR UPDATE the latest
//      active enrollment for the same email. The row lock serializes parallel
//      submissions for the same email (multi-tab, double-click, retries from
//      different devices) so they always converge on a single record.
//   3. If an existing row was found, UPDATE its personal details with the new
//      form data and return it as a "resumed" enrollment so the student moves
//      straight on to plan selection — regardless of its prior state. Status is
//      preserved except failed/expired, which reset to 'submitted'. A paid row
//      keeps its paid status: the student can update details and reach plan
//      selection, but selectForEnrollment refuses any plan change / re-charge
//      on a paid enrollment (no double-charge). See RESUME_RESET_STATUSES.
//   4. If no existing row was found, INSERT a new one. The partial unique
//      index `uniq_enrollments_email_active` makes this race-safe: if two
//      transactions both saw nothing and both try to INSERT, the loser hits
//      P2002 and we transparently fall back to the UPDATE path with the
//      winner's row.
//
// All DB writes for a single request live inside one interactive transaction,
// so a crash mid-request can't leave a half-created enrollment behind.
// ---------------------------------------------------------------------------

// Public re-enrollment is an in-place upsert by email. A student returning with
// an email that already has an enrollment — incomplete OR already paid — has
// that SAME row's personal details updated and is sent forward to plan
// selection. There is only ever one active row per email
// (uniq_enrollments_email_active is a unique index on lower(email) WHERE
// deleted_at IS NULL), so we always reuse it rather than create a second.
//
// Status policy when reusing the row:
//   submitted / payment_pending → keep (mid-flow; preserves plan_pricing_id)
//   failed / expired            → reset to 'submitted' so the student can walk
//                                 the flow cleanly (these never paid)
//   paid / completed /          → KEEP as-is. The returning student's details
//   sync_pending                  are updated and they reach the plan-selection
//                                 page, but their paid plan stands: the
//                                 selectForEnrollment guard refuses any plan
//                                 change / re-charge on a paid enrollment, so
//                                 we must NOT reset a settled record's status.
const RESUME_RESET_STATUSES = ['failed', 'expired'];
function nextStatusOnResume(currentStatus) {
  return RESUME_RESET_STATUSES.includes(currentStatus) ? 'submitted' : currentStatus;
}

/**
 * Build the data dict for the new-shape create path. Pure function — no DB.
 * Returned object is used for both INSERT (full row) and UPDATE (partial
 * resume; we drop email/amount/enrollment_code/candidate_type so they stay
 * stable across resumes).
 */
function buildNewShapeBaseData(body) {
  const { first_name, last_name } = splitName(body.name);
  return {
    first_name,
    last_name,
    phone_number: body.phone,
    name: body.name.trim(),
    user_role: body.role || null,
    education: body.education || null,
    readiness: body.readiness || null,
    source: body.source || null,
    promo_code: body.promoCode ? body.promoCode.trim().toUpperCase() : null,
  };
}

function buildLegacyShapeBaseData(body) {
  return {
    first_name: body.first_name,
    last_name: body.last_name,
    phone_number: body.phone_number,
    plan: body.plan,
    group: body.group,
    unit: body.unit,
    phase: body.phase,
    segment: body.segment,
    amount: body.amount,
  };
}

async function createEnrollment(body, traceId) {
  const newShape = isNewShape(body);
  const phoneNumber = newShape ? body.phone : body.phone_number;
  const email = body.email; // already lower-cased by Joi validator

  // ------------------------------------------------------------------
  // Pre-transaction: optional promo code re-validation.
  // We do this outside the tx so an invalid promo code doesn't hold a
  // row lock for the duration of an external lookup.
  // ------------------------------------------------------------------
  if (newShape && body.promoCode) {
    const promoMatch = await findActivePromoCode(body.promoCode);
    if (!promoMatch) {
      logger.warn({ msg: 'enrollment_promo_code_invalid', traceId, email: maskEmail(email) });
      throw new ApiError(400, 'PROMO_CODE_INVALID', 'Invalid or inactive promo code.');
    }
  }

  // ------------------------------------------------------------------
  // Short-circuit: 5-minute dedupe for impatient double-click /
  // network-retry submissions within the same browser session. Uses the
  // (email, phone, status='submitted') signature so it only fires when
  // the freshly-created row hasn't moved past the first step yet.
  //
  // Kept OUTSIDE the upsert tx because it's a cache-friendly read with
  // no need for locking and short-circuits the common-case retry.
  // ------------------------------------------------------------------
  const dedup = await repo.findRecentDuplicate(email, phoneNumber);
  if (dedup) {
    logger.info({
      msg: 'enrollment_deduped',
      traceId,
      enrollment_id: dedup.id,
      email: maskEmail(email),
    });
    return { enrollment: dedup, created: false, resumed: false };
  }

  // ------------------------------------------------------------------
  // Build the per-shape data dictionaries.
  // ------------------------------------------------------------------
  const baseData = newShape ? buildNewShapeBaseData(body) : buildLegacyShapeBaseData(body);

  const insertData = newShape
    ? {
        ...baseData,
        email,
        amount: DEFAULT_ENROLLMENT_AMOUNT_PAISE,
        plan: null,
        group: null,
        unit: null,
        phase: null,
        segment: null,
        status: 'submitted',
        enrollment_code: generateEnrollmentCode(),
        candidate_type: 'EXTERNAL',
      }
    : {
        ...baseData,
        email,
        status: 'submitted',
        name: null,
        enrollment_code: null,
        user_role: null,
        education: null,
        readiness: null,
        source: null,
        promo_code: null,
      };

  // ------------------------------------------------------------------
  // Interactive transaction: lock → branch (resume vs insert).
  // ------------------------------------------------------------------
  const db = getPrismaClient();

  const result = await db.$transaction(
    async (tx) => {
      // 1) Lock any existing active row for this email.
      const existing = await repo.findActiveByEmailForUpdate(tx, email);

      if (existing) {
        // An external student who already has a SETTLED enrollment is directed
        // to their student panel to purchase a plan — we do NOT let them
        // re-enroll (and overwrite their settled record) from the public
        // website, since they already have a login + panel. Incomplete drafts
        // (submitted / payment_pending / failed / expired) still resume below.
        const alreadySettled =
          repo.PAID_ENROLLMENT_STATUSES.includes(existing.status) ||
          (await tx.payment.count({
            where: { enrollment_id: existing.id, status: 'success' },
          })) > 0;
        if (alreadySettled) {
          logger.info({
            msg: 'enrollment_already_settled_login_required',
            traceId,
            enrollment_id: existing.id,
            email: maskEmail(email),
          });
          throw new ApiError(
            409,
            'ENROLLMENT_ALREADY_EXISTS',
            'This enrollment already exists. Please log in to your student panel to purchase a plan.',
          );
        }

        // Resume / re-enroll — update the existing row (whatever its current
        // state) with the freshly submitted form data and send the student on
        // to plan selection. See RESUME_RESET_STATUSES above for the status
        // policy: terminal/paid states reset to 'submitted' so the flow can be
        // walked cleanly again; mid-flow states are preserved.
        const nextStatus = nextStatusOnResume(existing.status);

        const updated = await tx.enrollment.update({
          where: { id: existing.id },
          data: { ...baseData, status: nextStatus },
        });

        logger.info({
          msg: 'enrollment_resumed',
          traceId,
          enrollment_id: updated.id,
          previous_status: existing.status,
          next_status: nextStatus,
          shape: newShape ? 'new' : 'legacy',
          email: maskEmail(email),
        });

        return { enrollment: updated, created: false, resumed: true };
      }

      // 3) No active row → INSERT. The partial unique index handles the
      // race where two parallel txns both saw nothing and both tried to
      // INSERT: the loser hits P2002 and we retry the resume path with
      // the winner's row.
      try {
        const created = await tx.enrollment.create({ data: insertData });

        logger.info({
          msg: 'enrollment_created',
          traceId,
          enrollment_id: created.id,
          enrollment_code: created.enrollment_code,
          shape: newShape ? 'new' : 'legacy',
          email: maskEmail(email),
        });

        return { enrollment: created, created: true, resumed: false };
      } catch (e) {
        if (e && e.code === 'P2002') {
          // Race: another tx inserted between our SELECT and INSERT.
          // Re-acquire the lock and retry as a resume.
          const retry = await repo.findActiveByEmailForUpdate(tx, email);
          if (!retry) {
            // Extremely unlikely — would mean the winning row was deleted
            // between the failed INSERT and the retry SELECT. Rethrow so
            // the caller sees the genuine error.
            throw e;
          }
          const nextStatus = nextStatusOnResume(retry.status);
          const updated = await tx.enrollment.update({
            where: { id: retry.id },
            data: { ...baseData, status: nextStatus },
          });
          logger.info({
            msg: 'enrollment_resumed_after_unique_race',
            traceId,
            enrollment_id: updated.id,
            previous_status: retry.status,
            next_status: nextStatus,
            email: maskEmail(email),
          });
          return { enrollment: updated, created: false, resumed: true };
        }
        throw e;
      }
    },
    {
      // 15s — same as the rest of the repo. Remote dev DB latency makes
      // Prisma's 5s default too tight; the upsert path does at most 4
      // sequential round-trips (SELECT FOR UPDATE → payment count → INSERT
      // or UPDATE → return).
      timeout: 15000,
      maxWait: 5000,
    },
  );

  return result;
}

// ---------------------------------------------------------------------------
// getEnrollmentById
// ---------------------------------------------------------------------------

async function getEnrollmentById(id, traceId) {
  const enrollment = await repo.findEnrollmentById(id);
  if (!enrollment) {
    logger.warn({ msg: 'enrollment_not_found', traceId, enrollment_id: id });
    throw ApiError.notFound('Enrollment not found');
  }
  return enrollment;
}

// ---------------------------------------------------------------------------
// listEnrollments
// ---------------------------------------------------------------------------

async function listEnrollments(query, traceId) {
  const { page, limit, skip, sortBy, sortOrder, dateFrom, dateTo } = parsePagination(query);

  const where = { deleted_at: null };

  // Status filter. The validator restricts to a known set, but we also
  // ignore empty strings here so a "All statuses" select that emits "" can
  // be passed through verbatim by the frontend.
  if (query.status) {
    const s = String(query.status);
    // The validator accepts both payment-lifecycle and SYNC_* values in the
    // single `status` field for backwards compat; SYNC_* values are mapped
    // to the dedicated column instead so we don't ever assign them to
    // enrollments.status (where they'd match zero rows).
    if (s.startsWith('SYNC_')) {
      where.external_sync_status = s.replace(/^SYNC_/, '');
    } else if (['PAID', 'PARTIAL', 'PENDING', 'FULLY_DISCOUNTED'].includes(s)) {
      where.internal_payment_status = s;
    } else {
      where.status = s;
    }
  }

  // Dedicated external-sync filter. Overrides the SYNC_* mapping above if
  // both are sent (admin filter row + global search both contributing).
  if (query.externalSyncStatus) {
    where.external_sync_status = String(query.externalSyncStatus);
  }

  // Server-side candidate-type filter. Accept INTERNAL / EXTERNAL (case-
  // insensitive on the wire). Frontend sends `candidateType` AND the legacy
  // `source` alias with the same value; either one wins. Any other value is
  // ignored so a malformed query param doesn't accidentally hide rows.
  const candidateTypeRaw = query.candidateType ?? query.source;
  if (candidateTypeRaw) {
    const v = String(candidateTypeRaw).toUpperCase();
    if (v === 'INTERNAL' || v === 'EXTERNAL') where.candidate_type = v;
  }

  // Date-range aliases: frontend sends `fromDate` / `toDate`. Treat them as
  // additive to dateFrom/dateTo (whichever is set wins, both are end-of-day-
  // inclusive at the frontend layer).
  const rangeFrom = dateFrom ?? (query.fromDate ? new Date(query.fromDate) : null);
  const rangeTo   = dateTo   ?? (query.toDate   ? new Date(`${query.toDate}T23:59:59.999`) : null);
  if (rangeFrom || rangeTo) {
    where.created_at = where.created_at || {};
    if (rangeFrom) where.created_at.gte = rangeFrom;
    if (rangeTo)   where.created_at.lte = rangeTo;
  }

  if (query.search) {
    const term = query.search.trim();
    // Trigram GIN indexes (enrollments_*_trgm_idx) need ≥3 chars to be
    // effective — shorter patterns degenerate to a sequential scan because
    // PostgreSQL cannot extract a trigram. Silently drop sub-3-char text
    // searches; numeric prefixes (phone-number lookups) are allowed at any
    // length because they use the btree index on phone_number.
    const isNumeric = /^\+?\d+$/.test(term);
    if (isNumeric) {
      where.phone_number = { startsWith: term.replace(/^\+/, '') };
    } else if (term.length >= 3) {
      where.OR = [
        { email:        { contains: term, mode: 'insensitive' } },
        { first_name:   { contains: term, mode: 'insensitive' } },
        { last_name:    { contains: term, mode: 'insensitive' } },
        { name:         { contains: term, mode: 'insensitive' } },
      ];
    }
  }
  // (dateFrom / dateTo handling moved up next to candidate_type filter so the
  // `fromDate` / `toDate` aliases from the frontend Enrollments page are honoured.)

  const { rows, total } = await repo.listEnrollments({
    skip,
    take: limit,
    where,
    orderBy: { [sortBy]: sortOrder },
  });

  logger.info({ msg: 'enrollment_list', traceId, total, page, limit });

  return { rows, meta: buildMeta(page, limit, total) };
}

// ---------------------------------------------------------------------------
// createSelfServiceEnrollment — logged-in student purchasing a new plan
// ---------------------------------------------------------------------------
//
// Authenticated panel purchase flow. A returning student is blocked from the
// public POST /enrollments (they're routed to the panel), so this is how they
// start a new purchase. Identity comes from the token (email); name/phone are
// auto-filled from their most recent enrollment.
//
// One in-progress draft per email is allowed (DB unique index), so we REUSE an
// existing submitted/payment_pending draft if present (reset to a clean
// submitted state) rather than insert a second one. Paid history rows are never
// touched. The returned enrollment is then driven through the existing
// selectForEnrollment + payment-order + payment-verify endpoints unchanged.
async function createSelfServiceEnrollment({ email }, traceId) {
  const db = getPrismaClient();
  const emailLower = String(email || '').trim().toLowerCase();
  if (!emailLower) throw ApiError.badRequest('Authenticated user has no email');

  // Auto-fill identity from the student's most recent enrollment.
  const prior = await db.enrollment.findFirst({
    where: { email: { equals: emailLower, mode: 'insensitive' }, deleted_at: null },
    orderBy: { created_at: 'desc' },
    select: {
      name: true, first_name: true, last_name: true, phone_number: true,
      user_role: true, education: true, readiness: true, source: true,
    },
  });
  const fullName =
    prior?.name ||
    [prior?.first_name, prior?.last_name].filter(Boolean).join(' ') ||
    emailLower.split('@')[0];
  const { first_name, last_name } = splitName(fullName);

  const baseData = {
    name:         fullName,
    first_name,
    last_name,
    phone_number: prior?.phone_number || null,
    user_role:    prior?.user_role || null,
    education:    prior?.education || null,
    readiness:    prior?.readiness || null,
    source:       prior?.source || null,
    status:       'submitted',
    plan_pricing_id: null,
    candidate_type: 'EXTERNAL',
  };

  const result = await db.$transaction(async (tx) => {
    // Reuse an existing in-progress draft if any (one-draft-per-email index).
    const rows = await tx.$queryRaw`
      SELECT id FROM "enrollments"
      WHERE lower(email) = lower(${emailLower}) AND deleted_at IS NULL
        AND status IN ('submitted', 'payment_pending')
      ORDER BY created_at DESC LIMIT 1
      FOR UPDATE
    `;
    const draftId = rows && rows[0] ? rows[0].id : null;
    if (draftId) {
      return tx.enrollment.update({ where: { id: draftId }, data: baseData });
    }
    return tx.enrollment.create({
      data: {
        ...baseData,
        email: emailLower,
        enrollment_code: generateEnrollmentCode(),
        amount: DEFAULT_ENROLLMENT_AMOUNT_PAISE,
      },
    });
  }, { timeout: 15000, maxWait: 5000 });

  logger.info({
    msg: 'self_service_enrollment_created',
    traceId,
    enrollment_id: result.id,
    email: maskEmail(emailLower),
  });

  return { enrollment: result };
}

module.exports = {
  createEnrollment,
  getEnrollmentById,
  listEnrollments,
  createSelfServiceEnrollment,
};
