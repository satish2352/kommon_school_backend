'use strict';

const Joi = require('joi');

// ---------------------------------------------------------------------------
// Shared field-level regexes
//
// These mirror src/services/validation.js on the frontend so the same
// rule is enforced on both sides. Backend is the authoritative gate —
// any rule change must land here first, frontend second.
// ---------------------------------------------------------------------------

// Name: ASCII letters joined by single spaces. Indian student names in
// Latin script never need digits or symbols; rejecting them stops bot
// junk like "test123" / "abc@@" from polluting the DB.
const NAME_REGEX = /^[A-Za-z]+(?: [A-Za-z]+)*$/;

// Indian mobile: 10 digits, leading digit in 6-9. TRAI reserves leading
// 0-5 for landline / unassigned ranges, so a "5…" number is a typo or
// abuse signal.
const INDIAN_MOBILE_REGEX = /^[6-9]\d{9}$/;

// Strict email: local@domain.tld with TLD >= 2 chars. Joi's built-in
// .email() validator does most of this, but a belt-and-suspenders
// .pattern() also rejects "test@gmail.c" (1-char TLD) regardless of
// Joi's TLD list state.
const EMAIL_REGEX =
  /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9](?:[A-Za-z0-9.\-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$/;

// ---------------------------------------------------------------------------
// Legacy shape — admin/internal callers that pass the full snake_case payload
// ---------------------------------------------------------------------------
const legacyEnrollmentSchema = Joi.object({
  first_name:   Joi.string().trim().min(1).max(100).required(),
  last_name:    Joi.string().trim().min(1).max(100).required(),
  email:        Joi.string()
    .email()
    .lowercase()
    .trim()
    .max(255)
    .pattern(EMAIL_REGEX)
    .required()
    .messages({ 'string.pattern.base': 'email must be a valid email address' }),
  phone_number: Joi.string()
    .pattern(/^\+?[1-9]\d{7,14}$/)
    .required()
    .messages({ 'string.pattern.base': 'phone_number must be a valid phone number' }),
  plan:    Joi.string().trim().min(1).max(100).required(),
  group:   Joi.string().trim().min(1).max(100).required(),
  unit:    Joi.string().trim().min(1).max(100).required(),
  phase:   Joi.string().trim().min(1).max(100).required(),
  segment: Joi.string().trim().min(1).max(100).required(),
  amount:  Joi.number().integer().min(1).required(),
});

// ---------------------------------------------------------------------------
// New (frontend) shape — React enrollment modal
// ---------------------------------------------------------------------------
const newEnrollmentSchema = Joi.object({
  name:  Joi.string()
    .trim()
    .min(2)
    .max(100)
    .pattern(NAME_REGEX)
    .required()
    .messages({
      'string.pattern.base': 'name must contain letters and spaces only',
      'string.min':          'name must be at least 2 characters',
      'string.max':          'name must be 100 characters or less',
    }),
  phone: Joi.string()
    .pattern(INDIAN_MOBILE_REGEX)
    .required()
    .messages({
      'string.pattern.base':
        'phone must be a 10-digit Indian mobile number starting with 6, 7, 8, or 9',
    }),
  email: Joi.string()
    .email()
    .lowercase()
    .trim()
    .max(255)
    .pattern(EMAIL_REGEX)
    .required()
    .messages({ 'string.pattern.base': 'email must be a valid email address' }),
  role:  Joi.string()
    .valid('STUDENT', 'FRESH_GRADUATE', 'WORKING_PROFESSIONAL', 'CAREER_SWITCHER')
    .required(),
  // Education is required on the public website flow — mirrors the
  // frontend gate added at the same time. Pre-existing enrollments
  // may still have NULL education in the DB (column is nullable), so
  // we only enforce this on NEW submissions, not on schema migration.
  education: Joi.string()
    .valid('SCHOOL', 'JR_COLLEGE', 'UNDERGRADUATE', 'GRADUATE', 'POST_GRADUATE', 'DOCTORATE', 'OTHER')
    .required()
    .messages({
      'any.required': 'education is required',
      'any.only':     'education must be one of SCHOOL, JR_COLLEGE, UNDERGRADUATE, GRADUATE, POST_GRADUATE, DOCTORATE, OTHER',
    }),
  readiness: Joi.string()
    .valid('BEGINNER', 'INTERMEDIATE', 'READY_FOR_INTERVIEW')
    .optional(),
  source: Joi.string()
    .valid('SOCIAL_MEDIA', 'COLLEGE', 'FRIEND', 'GOOGLE', 'OTHER')
    .optional(),
  // promoCode — optional. The public website form no longer collects a
  // promo code; admin/internal flows may still pass one. When present, Joi
  // trims + uppercases before the service receives it (single normalisation
  // point); when absent, the service skips the promo-code lookup entirely.
  promoCode: Joi.string().trim().uppercase().min(2).max(50).optional(),
  // idempotencyKey is handled at the HTTP layer; strip it here so it is not
  // passed to the service or stored in the database.
  idempotencyKey: Joi.string().optional(),
});

// ---------------------------------------------------------------------------
// Combined schema: accepts EITHER shape, rejects if neither matches.
// Joi alternatives.try() attempts each branch in order and uses the first
// that passes. Both branches are exhaustive on their own required fields so
// a mixed payload that satisfies neither will produce a clear error.
// ---------------------------------------------------------------------------
const createEnrollmentSchema = Joi.alternatives()
  .try(legacyEnrollmentSchema, newEnrollmentSchema)
  .messages({
    'alternatives.match':
      'Request body must match either the legacy enrollment shape ' +
      '(first_name, last_name, phone_number, plan, group, unit, phase, segment, amount) ' +
      'or the new shape (name, phone, email, role; education/readiness/source/promoCode optional)',
  });

// ---------------------------------------------------------------------------
// List query schema — unchanged
// ---------------------------------------------------------------------------
const listEnrollmentQuerySchema = Joi.object({
  page:      Joi.number().integer().min(1).default(1),
  limit:     Joi.number().integer().min(1).max(100).default(20),
  sortBy:    Joi.string().valid('created_at', 'updated_at', 'email', 'status', 'amount').default('created_at'),
  sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
  search:    Joi.string().trim().max(255).optional(),
  status:    Joi.string()
    .valid('submitted', 'payment_pending', 'paid', 'completed', 'failed', 'expired')
    .optional(),
  dateFrom: Joi.date().iso().optional(),
  dateTo:   Joi.date().iso().min(Joi.ref('dateFrom')).optional(),
  // Filter list by candidate origin. Frontend's Enrollments page sends this
  // as `candidateType`; accept it via uppercase enum match.
  candidateType: Joi.string().valid('INTERNAL', 'EXTERNAL').optional(),
  // Frontend also sends `source` and `fromDate`/`toDate` as aliases for
  // candidateType/dateFrom/dateTo respectively; accept those gracefully.
  source:    Joi.string().valid('INTERNAL', 'EXTERNAL').optional(),
  fromDate:  Joi.date().iso().optional(),
  toDate:    Joi.date().iso().optional(),
});

// ---------------------------------------------------------------------------
// Route-param schema: /:id (UUID)
// ---------------------------------------------------------------------------
const idParamSchema = Joi.object({
  id: Joi.string().uuid().required(),
});

// ---------------------------------------------------------------------------
// Start-upgrade schema — public /enrollments/upgrade. Only an email is needed;
// identity is auto-filled server-side from the student's prior enrollment.
// ---------------------------------------------------------------------------
const startUpgradeSchema = Joi.object({
  email: Joi.string()
    .email()
    .lowercase()
    .trim()
    .max(255)
    .pattern(EMAIL_REGEX)
    .required()
    .messages({ 'string.pattern.base': 'email must be a valid email address' }),
});

// ---------------------------------------------------------------------------
// Nested payment-verify schema — camelCase from frontend
// ---------------------------------------------------------------------------
const verifyPaymentNestedSchema = Joi.object({
  paymentId:          Joi.string().required(),
  razorpayOrderId:    Joi.string().required(),
  razorpayPaymentId:  Joi.string().required(),
  razorpaySignature:  Joi.string().required(),
});

module.exports = {
  createEnrollmentSchema,
  listEnrollmentQuerySchema,
  idParamSchema,
  verifyPaymentNestedSchema,
  startUpgradeSchema,
};
