'use strict';

const Joi = require('joi');

// ---------------------------------------------------------------------------
// List / filter query schema
// ---------------------------------------------------------------------------

const listDeliveryQuerySchema = Joi.object({
  page:   Joi.number().integer().min(1).default(1),
  limit:  Joi.number().integer().min(1).max(100).default(20),
  search: Joi.string().trim().max(255).optional(),
  status: Joi.string().valid('success', 'failed', 'error').optional(),
  source: Joi.string().valid('BACKEND', 'ADMIN_TEST').optional(),
});

// ---------------------------------------------------------------------------
// Route-param schema: /:id (integer PK)
// ---------------------------------------------------------------------------

const deliveryIdParamSchema = Joi.object({
  id: Joi.number().integer().min(1).required(),
});

// ---------------------------------------------------------------------------
// POST /test body schema
// ---------------------------------------------------------------------------

const planSelectionSchema = Joi.object({
  id:              Joi.number().integer().optional().allow(null),
  tier:            Joi.string().optional().allow('', null),
  name:            Joi.string().optional().allow('', null),
  promoCode:       Joi.string().optional().allow('', null),
  durationMonths:  Joi.number().integer().min(1).optional().allow(null),
  basePrice:       Joi.number().min(0).optional().allow(null),
  discountPercent: Joi.number().min(0).max(100).optional().allow(null),
  finalPrice:      Joi.number().min(0).optional().allow(null),
  discountLabel:   Joi.string().optional().allow('', null),
}).allow(null).optional();

const sendTestSchema = Joi.object({
  enrollment: Joi.object({
    id:           Joi.string().optional().allow('', null),
    enrollmentId: Joi.string().optional().allow('', null),
    name:         Joi.string().optional().allow('', null),
    email:        Joi.string().email().optional().allow('', null),
    phone:        Joi.string().optional().allow('', null),
  }).optional().allow(null),
  order: Joi.object({
    amount:   Joi.number().integer().min(0).optional(),
    currency: Joi.string().optional().allow('', null),
  }).optional().allow(null),
  rzpResponse: Joi.object({
    razorpay_payment_id: Joi.string().optional().allow('', null),
  }).allow(null).optional(),
  planSelection: planSelectionSchema,
}).options({ allowUnknown: false });

module.exports = { listDeliveryQuerySchema, deliveryIdParamSchema, sendTestSchema };
