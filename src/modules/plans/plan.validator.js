'use strict';

const Joi = require('joi');

// Valid duration months set
const VALID_DURATION_MONTHS = [1, 3, 6, 12];
const VALID_TIERS = ['SILVER', 'GOLD', 'PLATINUM'];

// External integration Plan ID format: 1–100 chars, ASCII letters/digits/_/-.
// Matches SKU-style codes like SUMAGOTEST_SILVER_1MONTH. Trimmed before
// validation. Required on every write; uniqueness enforced at the DB level
// via partial unique index.
const EXTERNAL_PLAN_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const externalPlanIdSchema = Joi.string()
  .trim()
  .min(1)
  .max(100)
  .pattern(EXTERNAL_PLAN_ID_PATTERN)
  .messages({
    'string.pattern.base': 'Plan ID may contain only letters, digits, underscores, and hyphens',
    'string.empty':        'Plan ID is required',
    'any.required':        'Plan ID is required',
  });

// ---------------------------------------------------------------------------
// Pricing sub-schema (used inside createPlanSchema pricings array)
// ---------------------------------------------------------------------------
const pricingSchema = Joi.object({
  durationMonths:  Joi.number().integer().valid(...VALID_DURATION_MONTHS).required(),
  basePrice:       Joi.number().min(0).max(999999.99).precision(2).required(),
  discountPercent: Joi.number().min(0).max(100).precision(2).optional().default(0),
  // finalPrice is computed server-side; client value is ignored if provided
  finalPrice:      Joi.number().min(0).precision(2).optional(),
  discountLabel:   Joi.string().max(100).optional().allow('', null),
  externalPlanId:  externalPlanIdSchema.required(),
  status:          Joi.string().valid('ACTIVE', 'INACTIVE').optional(),
});

// ---------------------------------------------------------------------------
// Create schema
// ---------------------------------------------------------------------------
const createPlanSchema = Joi.object({
  name:           Joi.string().trim().min(1).max(100).required(),
  tier:           Joi.string().valid(...VALID_TIERS).required(),
  tagline:        Joi.string().max(200).optional().allow('', null),
  description:    Joi.string().max(2000).optional().allow('', null),
  features:       Joi.array().items(Joi.string().max(200)).max(20).optional(),
  highlightLabel: Joi.string().max(50).optional().allow('', null),
  promoCode:      Joi.string().max(50).optional().allow('', null),
  sortOrder:      Joi.number().integer().min(0).optional(),
  status:         Joi.string().valid('ACTIVE', 'INACTIVE').optional(),
  pricings:       Joi.array().items(pricingSchema).min(1).optional(),
  isSystemDefault: Joi.forbidden(),
});

// ---------------------------------------------------------------------------
// Update schema — all fields optional; tier and isSystemDefault forbidden
// ---------------------------------------------------------------------------
const updatePlanSchema = Joi.object({
  name:           Joi.string().trim().min(1).max(100).optional(),
  tagline:        Joi.string().max(200).optional().allow('', null),
  description:    Joi.string().max(2000).optional().allow('', null),
  features:       Joi.array().items(Joi.string().max(200)).max(20).optional(),
  highlightLabel: Joi.string().max(50).optional().allow('', null),
  promoCode:      Joi.string().max(50).optional().allow('', null),
  sortOrder:      Joi.number().integer().min(0).optional(),
  status:         Joi.string().valid('ACTIVE', 'INACTIVE').optional(),
  tier:           Joi.forbidden(),
  isSystemDefault: Joi.forbidden(),
}).min(1);

// ---------------------------------------------------------------------------
// Set status schema
// ---------------------------------------------------------------------------
const setStatusSchema = Joi.object({
  status: Joi.string().valid('ACTIVE', 'INACTIVE').required(),
});

// ---------------------------------------------------------------------------
// Upsert pricing schema
// ---------------------------------------------------------------------------
const upsertPricingSchema = Joi.object({
  basePrice:       Joi.number().min(0).max(999999.99).precision(2).required(),
  discountPercent: Joi.number().min(0).max(100).precision(2).optional().default(0),
  // finalPrice is computed server-side; client value is ignored if provided
  finalPrice:      Joi.number().min(0).precision(2).optional(),
  discountLabel:   Joi.string().max(100).optional().allow('', null),
  externalPlanId:  externalPlanIdSchema.required(),
  status:          Joi.string().valid('ACTIVE', 'INACTIVE').optional(),
});

// ---------------------------------------------------------------------------
// List / filter query schemas
// ---------------------------------------------------------------------------
const listPlanQuerySchema = Joi.object({
  page:   Joi.number().integer().min(1).default(1),
  limit:  Joi.number().integer().min(1).max(100).default(10),
  search: Joi.string().trim().max(255).optional(),
  tier:   Joi.string().valid(...VALID_TIERS).optional(),
  status: Joi.string().valid('ACTIVE', 'INACTIVE').optional(),
});

// ---------------------------------------------------------------------------
// Route-param schemas
// ---------------------------------------------------------------------------
const planIdParamSchema = Joi.object({
  id: Joi.number().integer().min(1).required(),
});

const planPricingParamSchema = Joi.object({
  planId:    Joi.number().integer().min(1).required(),
  pricingId: Joi.number().integer().min(1).required(),
});

const planDurationParamSchema = Joi.object({
  planId:         Joi.number().integer().min(1).required(),
  durationMonths: Joi.number().integer().valid(...VALID_DURATION_MONTHS).required(),
});

// ---------------------------------------------------------------------------
// Enrollment plan selection schema (PATCH /enrollments/:id/plan)
// ---------------------------------------------------------------------------
const selectForEnrollmentSchema = Joi.object({
  planPricingId: Joi.number().integer().min(1).required(),
});

// Enrollment ID param (UUID string)
const enrollmentIdParamSchema = Joi.object({
  id: Joi.string().guid({ version: ['uuidv4'] }).required(),
});

module.exports = {
  createPlanSchema,
  updatePlanSchema,
  setStatusSchema,
  upsertPricingSchema,
  listPlanQuerySchema,
  planIdParamSchema,
  planPricingParamSchema,
  planDurationParamSchema,
  selectForEnrollmentSchema,
  enrollmentIdParamSchema,
};
