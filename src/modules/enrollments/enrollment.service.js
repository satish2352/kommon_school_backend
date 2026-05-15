'use strict';

const crypto = require('crypto');
const repo = require('./enrollment.repository');
const ApiError = require('../../utils/ApiError');
const logger = require('../../config/logger');
const { findActivePromoCode } = require('../promoCodes/promoCode.service');
const { parsePagination, buildMeta } = require('../../utils/pagination');
const {
  DEFAULT_ENROLLMENT_AMOUNT_PAISE,
  ENROLLMENT_CODE_PREFIX,
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
// ---------------------------------------------------------------------------

async function createEnrollment(body, traceId) {
  // Normalise phone_number so dedup works regardless of shape.
  // New shape sends `phone` (10 digits); legacy sends `phone_number`.
  const phoneNumber = isNewShape(body) ? body.phone : body.phone_number;
  const email = body.email;

  // Deduplicate concurrent/duplicate submissions within a 5-min window.
  // Edge case #10: return the existing record rather than creating a ghost.
  // This makes double-click / network-retry submissions idempotent.
  const existing = await repo.findRecentDuplicate(email, phoneNumber);
  if (existing) {
    logger.info({
      msg: 'enrollment_deduped',
      traceId,
      enrollment_id: existing.id,
      email: maskEmail(email),
    });
    return { enrollment: existing, created: false };
  }

  // Hard email uniqueness: outside the dedup window, reject any second
  // enrollment that reuses an email already on an active (non-deleted)
  // record. Applies to the public website flow only — admin manual/bulk
  // paths enforce the same rule in adminEnrollment.service.js.
  const existingByEmail = await repo.findActiveByEmail(email);
  if (existingByEmail) {
    logger.warn({
      msg: 'enrollment_email_already_exists',
      traceId,
      existing_enrollment_id: existingByEmail.id,
      email: maskEmail(email),
    });
    throw new ApiError(
      409,
      'EMAIL_ALREADY_ENROLLED',
      'An enrollment with this email already exists. Please use a different email or contact support if you need help.',
    );
  }

  let enrollmentData;

  if (isNewShape(body)) {
    // Promo code is optional. When provided, defense-in-depth re-validates
    // against the DB so a malicious client can't bypass the (now-optional)
    // frontend check. When absent (public website flow), skip the lookup.
    if (body.promoCode) {
      const promoMatch = await findActivePromoCode(body.promoCode);
      if (!promoMatch) {
        logger.warn({ msg: 'enrollment_promo_code_invalid', traceId, email: maskEmail(email) });
        throw new ApiError(400, 'PROMO_CODE_INVALID', 'Invalid or inactive promo code.');
      }
    }

    // ---- New frontend shape ----
    const { first_name, last_name } = splitName(body.name);
    const enrollmentCode = generateEnrollmentCode();

    enrollmentData = {
      // Derived legacy fields (kept for DB completeness / admin display)
      first_name,
      last_name,
      email,
      phone_number: phoneNumber,
      // Amount from constant until pricing module lands
      amount: DEFAULT_ENROLLMENT_AMOUNT_PAISE,
      // Legacy plan/group/unit/phase/segment: null for new-shape enrollments
      plan: null,
      group: null,
      unit: null,
      phase: null,
      segment: null,
      status: 'submitted',
      // New columns
      name: body.name.trim(),
      enrollment_code: enrollmentCode,
      user_role: body.role || null,
      education: body.education || null,
      readiness: body.readiness || null,
      source: body.source || null,
      // Promo code — store the normalised value when provided, null otherwise
      promo_code: body.promoCode ? body.promoCode.trim().toUpperCase() : null,
      // Public website flow → EXTERNAL candidate by definition. (Schema default
      // is also EXTERNAL, but being explicit makes intent obvious to readers.)
      candidate_type: 'EXTERNAL',
    };
  } else {
    // ---- Legacy shape — unchanged behaviour ----
    enrollmentData = {
      first_name: body.first_name,
      last_name: body.last_name,
      email,
      phone_number: phoneNumber,
      plan: body.plan,
      group: body.group,
      unit: body.unit,
      phase: body.phase,
      segment: body.segment,
      amount: body.amount,
      status: 'submitted',
      // New columns are null for legacy submissions
      name: null,
      enrollment_code: null,
      user_role: null,
      education: null,
      readiness: null,
      source: null,
      promo_code: null,
    };
  }

  const enrollment = await repo.createEnrollment(enrollmentData);

  logger.info({
    msg: 'enrollment_created',
    traceId,
    enrollment_id: enrollment.id,
    enrollment_code: enrollment.enrollment_code,
    shape: isNewShape(body) ? 'new' : 'legacy',
    email: maskEmail(email),
  });

  return { enrollment, created: true };
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

  if (query.status) where.status = query.status;

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
    where.OR = [
      { email:        { contains: term, mode: 'insensitive' } },
      { first_name:   { contains: term, mode: 'insensitive' } },
      { last_name:    { contains: term, mode: 'insensitive' } },
      { name:         { contains: term, mode: 'insensitive' } },
      { phone_number: { contains: term } },
    ];
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

module.exports = { createEnrollment, getEnrollmentById, listEnrollments };
