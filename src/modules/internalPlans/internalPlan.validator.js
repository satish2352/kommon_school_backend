'use strict';

const Joi = require('joi');

// ---------------------------------------------------------------------------
// Coupon sub-schema (used inside create/update body)
//
// IMPORTANT: `usedCount` MUST be declared here. With the global
// `stripUnknown: true` setting in validate.middleware.js, any field not
// declared here is silently dropped from the request body BEFORE the
// service sees it. That used to cause a real bug: editing a plan to
// add/remove a coupon would clobber every existing coupon's `usedCount`
// back to 0, since the admin form re-sent the array and the validator
// stripped the field, and the service then defaulted it to 0. The
// `id` field is also declared so it round-trips for the same reason.
// ---------------------------------------------------------------------------
const couponSchema = Joi.object({
  // Server-assigned sequential id. The form posts back whatever it loaded
  // so we accept any integer here; the service re-assigns ids via
  // normaliseCoupons (idx + 1) regardless.
  id:            Joi.number().integer().min(0).optional(),
  code:          Joi.string().trim().uppercase().max(50).required(),
  discountType:  Joi.string().valid('PERCENT', 'FLAT').required(),
  discountValue: Joi.number().positive().max(100000).required().when('discountType', {
    is: 'PERCENT',
    then: Joi.number().positive().max(100).required(),
  }),
  expiryDate:    Joi.string().isoDate().optional().allow(null, ''),
  usageLimit:    Joi.number().integer().positive().optional().allow(null),
  // Round-trip the live redemption counter so admin form edits preserve
  // it. Capped at 1e9 to reject obvious garbage. The service ALSO merges
  // from the existing DB row as a second line of defense in case the
  // frontend ever omits this field — see updateInternalPlan.
  usedCount:     Joi.number().integer().min(0).max(1_000_000_000).optional(),
  status:        Joi.string().valid('ACTIVE', 'INACTIVE').default('ACTIVE'),
});

// ---------------------------------------------------------------------------
// Create schema
// ---------------------------------------------------------------------------
const createInternalPlanSchema = Joi.object({
  name:        Joi.string().trim().min(2).max(200).required(),
  duration:    Joi.string().valid('1_MONTH', '3_MONTHS', '6_MONTHS', '12_MONTHS').required(),
  description: Joi.string().max(2000).optional().allow('', null),
  courseId:    Joi.number().integer().positive().required(),
  status:      Joi.string().valid('ACTIVE', 'INACTIVE').default('ACTIVE'),
  coupons:     Joi.array().items(couponSchema).default([]),
  // Optional Sumago plan-code override. Must be a string registered on
  // Sumago's allowlist for the organization. When set, this is used in
  // place of SUMAGO_PLAN_CODE for any enrollment bound to this plan.
  sumagoPlanCode: Joi.string().trim().max(100).optional().allow('', null),
  // refId is server-generated — forbid it in create body
  refId:       Joi.forbidden(),
});

// ---------------------------------------------------------------------------
// Update schema — all fields optional; refId explicitly forbidden
// ---------------------------------------------------------------------------
const updateInternalPlanSchema = Joi.object({
  name:        Joi.string().trim().min(2).max(200).optional(),
  duration:    Joi.string().valid('1_MONTH', '3_MONTHS', '6_MONTHS', '12_MONTHS').optional(),
  description: Joi.string().max(2000).optional().allow('', null),
  courseId:    Joi.number().integer().positive().optional(),
  status:      Joi.string().valid('ACTIVE', 'INACTIVE').optional(),
  coupons:     Joi.array().items(couponSchema).optional(),
  // Optional Sumago plan-code override (see create schema for semantics).
  sumagoPlanCode: Joi.string().trim().max(100).optional().allow('', null),
  // refId is immutable — reject if it appears in the body
  refId:       Joi.forbidden(),
}).min(1);

// ---------------------------------------------------------------------------
// Status-only update schema
// ---------------------------------------------------------------------------
const setStatusSchema = Joi.object({
  status: Joi.string().valid('ACTIVE', 'INACTIVE').required(),
});

// ---------------------------------------------------------------------------
// List query schema
// ---------------------------------------------------------------------------
const listInternalPlanQuerySchema = Joi.object({
  page:     Joi.number().integer().min(1).default(1),
  limit:    Joi.number().integer().min(1).max(100).default(10),
  search:   Joi.string().trim().max(255).optional(),
  courseId: Joi.number().integer().positive().optional(),
  status:   Joi.string().valid('ACTIVE', 'INACTIVE').optional(),
});

// ---------------------------------------------------------------------------
// Integer ID param schema (used for /:id and /by-course/:courseId)
// ---------------------------------------------------------------------------
const idParamSchema = Joi.object({
  id: Joi.number().integer().min(1).required(),
});

const courseIdParamSchema = Joi.object({
  courseId: Joi.number().integer().min(1).required(),
});

// ---------------------------------------------------------------------------
// Validate-coupon body schema
// ---------------------------------------------------------------------------
const validateCouponSchema = Joi.object({
  code:           Joi.string().trim().max(50).required(),
  internalPlanId: Joi.number().integer().positive().required(),
  basePrice:      Joi.number().positive().required(),
});

// ---------------------------------------------------------------------------
// Calculate-fee body schema
// ---------------------------------------------------------------------------
const calculateFeeSchema = Joi.object({
  internalPlanId: Joi.number().integer().positive().required(),
  basePrice:      Joi.number().positive().required(),
  couponCode:     Joi.string().trim().max(50).optional().allow('', null),
});

module.exports = {
  createInternalPlanSchema,
  updateInternalPlanSchema,
  setStatusSchema,
  listInternalPlanQuerySchema,
  idParamSchema,
  courseIdParamSchema,
  validateCouponSchema,
  calculateFeeSchema,
};
