'use strict';

const Joi = require('joi');

// ---------------------------------------------------------------------------
// Create schema
// ---------------------------------------------------------------------------
const createDurationMasterSchema = Joi.object({
  label:           Joi.string().trim().min(1).max(50).required(),
  sortOrder:       Joi.number().integer().min(0).max(9999).default(0).optional(),
  status:          Joi.string().valid('ACTIVE', 'INACTIVE').optional(),
  isSystemDefault: Joi.forbidden(),
});

// ---------------------------------------------------------------------------
// Update schema — all optional; at least one field
// ---------------------------------------------------------------------------
const updateDurationMasterSchema = Joi.object({
  label:           Joi.string().trim().min(1).max(50).optional(),
  sortOrder:       Joi.number().integer().min(0).max(9999).optional(),
  status:          Joi.string().valid('ACTIVE', 'INACTIVE').optional(),
  isSystemDefault: Joi.forbidden(),
}).min(1);

// ---------------------------------------------------------------------------
// List / filter query schema
// ---------------------------------------------------------------------------
const listDurationMasterQuerySchema = Joi.object({
  page:   Joi.number().integer().min(1).default(1),
  limit:  Joi.number().integer().min(1).max(100).default(10),
  search: Joi.string().trim().max(255).optional(),
  status: Joi.string().valid('ACTIVE', 'INACTIVE').optional(),
});

// ---------------------------------------------------------------------------
// Route-param schema: /:id (integer PK)
// ---------------------------------------------------------------------------
const durationMasterIdParamSchema = Joi.object({
  id: Joi.number().integer().min(1).required(),
});

module.exports = {
  createDurationMasterSchema,
  updateDurationMasterSchema,
  listDurationMasterQuerySchema,
  durationMasterIdParamSchema,
};
