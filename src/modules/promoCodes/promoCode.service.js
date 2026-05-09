'use strict';

const { getPrismaClient } = require('../../config/database');
const ApiError = require('../../utils/ApiError');
const logger = require('../../config/logger');

// ---------------------------------------------------------------------------
// findActivePromoCode — shared helper used by this service AND enrollment.service
// ---------------------------------------------------------------------------

/**
 * Find an ACTIVE course whose coupon matches code (case-insensitive).
 * Normalises the input: trim + uppercase before query.
 *
 * Uses a minimal select (id + nameOfCourseAsGroup + coupon) so it stays
 * lightweight on the hot validation + enrollment-create paths.
 *
 * @param {string} code - raw promo code from caller
 * @returns {Promise<{ id: number, nameOfCourseAsGroup: string, coupon: string } | null>}
 */
async function findActivePromoCode(code) {
  if (!code || typeof code !== 'string') return null;
  const normalized = code.trim().toUpperCase();
  if (normalized.length < 2) return null;

  const db = getPrismaClient();
  const course = await db.courseMaster.findFirst({
    where: {
      coupon: { equals: normalized, mode: 'insensitive' },
      status: 'ACTIVE',
    },
    select: { id: true, nameOfCourseAsGroup: true, coupon: true },
  });
  return course || null;
}

/**
 * Same lookup as findActivePromoCode but includes the education and duration
 * relations needed by the webhook payload builder.
 *
 * Kept separate from findActivePromoCode to avoid adding FK joins to the hot
 * promo-validation and enrollment-create paths that do not need those fields.
 * Only used by the webhook fire path (runs inside setImmediate, non-blocking).
 *
 * @param {string} code - raw promo code from caller
 * @returns {Promise<import('@prisma/client').CourseMaster & { education: object|null, duration: object|null } | null>}
 */
async function findActivePromoCodeWithRelations(code) {
  if (!code || typeof code !== 'string') return null;
  const normalized = code.trim().toUpperCase();
  if (normalized.length < 2) return null;

  const db = getPrismaClient();
  const course = await db.courseMaster.findFirst({
    where: {
      coupon: { equals: normalized, mode: 'insensitive' },
      status: 'ACTIVE',
    },
    include: { education: true, duration: true },
  });
  return course || null;
}

// ---------------------------------------------------------------------------
// validatePromoCode — used by the HTTP controller
// ---------------------------------------------------------------------------

/**
 * Validate a promo code and return the associated course.
 * Throws ApiError 400 PROMO_CODE_INVALID if not found or inactive.
 *
 * @param {string} code    - already-validated string (Joi guarantees trim+uppercase)
 * @param {string} traceId
 * @returns {Promise<{ valid: true, course: { id: number, nameOfCourseAsGroup: string, coupon: string } }>}
 */
async function validatePromoCode(code, traceId) {
  const course = await findActivePromoCode(code);
  if (!course) {
    logger.warn({ msg: 'promo_code_invalid', traceId, code });
    throw new ApiError(400, 'PROMO_CODE_INVALID', 'Invalid or inactive promo code.');
  }
  logger.info({ msg: 'promo_code_valid', traceId, code, course_id: course.id });
  return { valid: true, course };
}

module.exports = { findActivePromoCode, findActivePromoCodeWithRelations, validatePromoCode };
