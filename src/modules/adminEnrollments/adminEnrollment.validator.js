'use strict';

const Joi = require('joi');

// Same regex set as the public-flow validator (kept inline here rather
// than imported to avoid coupling admin paths to the public module).
const NAME_REGEX = /^[A-Za-z]+(?: [A-Za-z]+)*$/;
const INDIAN_MOBILE_REGEX = /^[6-9]\d{9}$/;
const EMAIL_REGEX =
  /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9](?:[A-Za-z0-9.\-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$/;

/**
 * Shared schema for a single manual enrollment row.
 * Used by both the manual endpoint and CSV bulk processing.
 *
 * Rules mirror the public newEnrollmentSchema so an admin can't bypass
 * the data-quality checks the public flow enforces.
 */
const manualEnrollmentSchema = Joi.object({
  name: Joi.string()
    .trim()
    .min(2)
    .max(100)
    .pattern(NAME_REGEX)
    .required()
    .messages({
      'string.pattern.base': 'name must contain letters and spaces only',
    }),
  email: Joi.string()
    .email()
    .lowercase()
    .trim()
    .max(255)
    .pattern(EMAIL_REGEX)
    .required()
    .messages({ 'string.pattern.base': 'email must be a valid email address' }),
  phone: Joi.string().pattern(INDIAN_MOBILE_REGEX).required().messages({
    'string.pattern.base':
      'phone must be a 10-digit Indian mobile number starting with 6, 7, 8, or 9',
  }),
  role: Joi.string()
    .valid('STUDENT', 'FRESH_GRADUATE', 'WORKING_PROFESSIONAL', 'CAREER_SWITCHER')
    .required(),
  education: Joi.string()
    .valid('SCHOOL', 'JR_COLLEGE', 'UNDERGRADUATE', 'GRADUATE', 'POST_GRADUATE', 'DOCTORATE', 'OTHER')
    .optional()
    .allow(null, ''),
  readiness: Joi.string()
    .valid('BEGINNER', 'INTERMEDIATE', 'READY_FOR_INTERVIEW')
    .optional()
    .allow(null, ''),
  source: Joi.string()
    .valid('SOCIAL_MEDIA', 'COLLEGE', 'FRIEND', 'GOOGLE', 'OTHER')
    .optional()
    .allow(null, ''),
  promoCode: Joi.string().max(50).optional().allow(null, '').default('NEW501'),
  planTier: Joi.string().valid('SILVER', 'GOLD', 'PLATINUM').required(),
  durationMonths: Joi.number().valid(1, 3, 6, 12).required(),
  notes: Joi.string().max(500).optional().allow(null, ''),
}).options({ stripUnknown: true });

// ---------------------------------------------------------------------------
// Admin internal-enrollment schema — used by POST /admin/enrollments/internal
//
// Pricing comes from internalPlanId + courseId + optional couponCode.
// Any fee values in the body are silently dropped (stripUnknown) so a
// tampered request can't change what the student is charged. The backend
// re-resolves CourseMaster.courseFee and re-validates the coupon against
// the live InternalPlan.coupons[] array inside its transaction.
// ---------------------------------------------------------------------------
const adminInternalEnrollmentSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100).pattern(NAME_REGEX).required()
    .messages({ 'string.pattern.base': 'name must contain letters and spaces only' }),
  email: Joi.string().email().lowercase().trim().max(255).pattern(EMAIL_REGEX).required()
    .messages({ 'string.pattern.base': 'email must be a valid email address' }),
  phone: Joi.string().pattern(INDIAN_MOBILE_REGEX).required().messages({
    'string.pattern.base':
      'phone must be a 10-digit Indian mobile number starting with 6, 7, 8, or 9',
  }),
  role: Joi.string()
    .valid('STUDENT', 'FRESH_GRADUATE', 'WORKING_PROFESSIONAL', 'CAREER_SWITCHER').required(),
  education: Joi.string()
    .valid('SCHOOL', 'JR_COLLEGE', 'UNDERGRADUATE', 'GRADUATE', 'POST_GRADUATE', 'DOCTORATE', 'OTHER')
    .optional().allow(null, ''),
  readiness: Joi.string()
    .valid('BEGINNER', 'INTERMEDIATE', 'READY_FOR_INTERVIEW').optional().allow(null, ''),
  source: Joi.string()
    .valid('SOCIAL_MEDIA', 'COLLEGE', 'FRIEND', 'GOOGLE', 'OTHER').optional().allow(null, ''),
  // Internal-flow specifics
  courseId:           Joi.number().integer().positive().required(),
  internalPlanId:     Joi.number().integer().positive().required(),
  internalCouponCode: Joi.string().trim().uppercase().max(50).optional().allow(null, ''),
  notes:              Joi.string().max(500).optional().allow(null, ''),
}).options({ stripUnknown: true });

// ---------------------------------------------------------------------------
// Bulk CSV row schema — only the student-identity fields. The Course +
// Internal Plan (and thus all pricing) are supplied once via the upload's
// planContext and applied to every row, so they're NOT in the CSV.
// ---------------------------------------------------------------------------
const bulkInternalRowSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100).pattern(NAME_REGEX).required()
    .messages({ 'string.pattern.base': 'name must contain letters and spaces only' }),
  email: Joi.string().email().lowercase().trim().max(255).pattern(EMAIL_REGEX).required()
    .messages({ 'string.pattern.base': 'email must be a valid email address' }),
  phone: Joi.string().pattern(INDIAN_MOBILE_REGEX).required().messages({
    'string.pattern.base':
      'phone must be a 10-digit Indian mobile number starting with 6, 7, 8, or 9',
  }),
}).options({ stripUnknown: true });

module.exports = { manualEnrollmentSchema, adminInternalEnrollmentSchema, bulkInternalRowSchema };
