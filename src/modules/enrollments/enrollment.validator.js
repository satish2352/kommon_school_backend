'use strict';

const Joi = require('joi');

// ---------------------------------------------------------------------------
// Legacy shape — admin/internal callers that pass the full snake_case payload
// ---------------------------------------------------------------------------
const legacyEnrollmentSchema = Joi.object({
  first_name:   Joi.string().trim().min(1).max(100).required(),
  last_name:    Joi.string().trim().min(1).max(100).required(),
  email:        Joi.string().email().lowercase().trim().max(255).required(),
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
  name:  Joi.string().trim().min(2).max(200).required(),
  phone: Joi.string().pattern(/^\d{10}$/).required()
    .messages({ 'string.pattern.base': 'phone must be exactly 10 digits' }),
  email: Joi.string().email().lowercase().trim().max(255).required(),
  role:  Joi.string()
    .valid('STUDENT', 'FRESH_GRADUATE', 'WORKING_PROFESSIONAL', 'CAREER_SWITCHER')
    .required(),
  education: Joi.string()
    .valid('SCHOOL', 'JR_COLLEGE', 'UNDERGRADUATE', 'GRADUATE', 'POST_GRADUATE', 'DOCTORATE', 'OTHER')
    .optional(),
  readiness: Joi.string()
    .valid('BEGINNER', 'INTERMEDIATE', 'READY_FOR_INTERVIEW')
    .optional(),
  source: Joi.string()
    .valid('SOCIAL_MEDIA', 'COLLEGE', 'FRIEND', 'GOOGLE', 'OTHER')
    .optional(),
  // promoCode — required for new-shape enrollments; Joi trims + uppercases
  // before the service receives it, providing a single normalisation point.
  promoCode: Joi.string().trim().uppercase().min(2).max(50).required(),
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
      'or the new shape (name, phone, email, role)',
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
});

// ---------------------------------------------------------------------------
// Route-param schema: /:id (UUID)
// ---------------------------------------------------------------------------
const idParamSchema = Joi.object({
  id: Joi.string().uuid().required(),
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
};
