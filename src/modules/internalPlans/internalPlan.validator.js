'use strict';

const Joi = require('joi');

// ---------------------------------------------------------------------------
// Coupon sub-schema (used inside create/update body)
// ---------------------------------------------------------------------------
const couponSchema = Joi.object({
  code:          Joi.string().trim().uppercase().max(50).required(),
  discountType:  Joi.string().valid('PERCENT', 'FLAT').required(),
  discountValue: Joi.number().positive().max(100000).required().when('discountType', {
    is: 'PERCENT',
    then: Joi.number().positive().max(100).required(),
  }),
  expiryDate:    Joi.string().isoDate().optional().allow(null, ''),
  usageLimit:    Joi.number().integer().positive().optional().allow(null),
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
