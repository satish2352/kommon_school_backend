'use strict';

const Joi = require('joi');

// ---------------------------------------------------------------------------
// Create schema
// ---------------------------------------------------------------------------
const createEducationMasterSchema = Joi.object({
  name:            Joi.string().trim().min(2).max(100).required(),
  code:            Joi.string().trim().uppercase().min(2).max(50)
                     .pattern(/^[A-Z0-9_]+$/, 'uppercase alphanumeric and underscore')
                     .required(),
  description:     Joi.string().max(500).optional().allow('', null),
  status:          Joi.string().valid('ACTIVE', 'INACTIVE').optional(),
  isSystemDefault: Joi.forbidden(),
});

// ---------------------------------------------------------------------------
// Update schema — all optional; at least one field
// ---------------------------------------------------------------------------
const updateEducationMasterSchema = Joi.object({
  name:            Joi.string().trim().min(2).max(100).optional(),
  code:            Joi.string().trim().uppercase().min(2).max(50)
                     .pattern(/^[A-Z0-9_]+$/, 'uppercase alphanumeric and underscore')
                     .optional(),
  description:     Joi.string().max(500).optional().allow('', null),
  status:          Joi.string().valid('ACTIVE', 'INACTIVE').optional(),
  isSystemDefault: Joi.forbidden(),
}).min(1);

// ---------------------------------------------------------------------------
// List / filter query schema
// ---------------------------------------------------------------------------
const listEducationMasterQuerySchema = Joi.object({
  page:   Joi.number().integer().min(1).default(1),
  limit:  Joi.number().integer().min(1).max(100).default(10),
  search: Joi.string().trim().max(255).optional(),
  status: Joi.string().valid('ACTIVE', 'INACTIVE').optional(),
});

// ---------------------------------------------------------------------------
// Route-param schema: /:id (integer PK)
// ---------------------------------------------------------------------------
const educationMasterIdParamSchema = Joi.object({
  id: Joi.number().integer().min(1).required(),
});

module.exports = {
  createEducationMasterSchema,
  updateEducationMasterSchema,
  listEducationMasterQuerySchema,
  educationMasterIdParamSchema,
};
