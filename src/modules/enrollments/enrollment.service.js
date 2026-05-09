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

  let enrollmentData;

  if (isNewShape(body)) {
    // Defense-in-depth: re-validate the promo code even though the frontend
    // pre-validates. This prevents a malicious client from bypassing the check.
    const promoMatch = await findActivePromoCode(body.promoCode || '');
    if (!promoMatch) {
      logger.warn({ msg: 'enrollment_promo_code_invalid', traceId, email: maskEmail(email) });
      throw new ApiError(400, 'PROMO_CODE_INVALID', 'Invalid or inactive promo code.');
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
      // Promo code — store the normalised (uppercase, trimmed) value
      promo_code: (body.promoCode || '').trim().toUpperCase(),
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

  if (dateFrom || dateTo) {
    where.created_at = {};
    if (dateFrom) where.created_at.gte = dateFrom;
    if (dateTo)   where.created_at.lte = dateTo;
  }

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
