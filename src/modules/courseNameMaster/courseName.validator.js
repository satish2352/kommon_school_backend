'use strict';

const Joi = require('joi');

// ---------------------------------------------------------------------------
// Create schema
// ---------------------------------------------------------------------------
const createCourseNameSchema = Joi.object({
  name:           Joi.string().trim().min(2).max(200).required(),
  description:    Joi.string().max(2000).optional().allow('', null),
  status:         Joi.string().valid('ACTIVE', 'INACTIVE').optional(),
  isSystemDefault: Joi.forbidden(),
});

// ---------------------------------------------------------------------------
// Update schema — all fields optional; at least one field
// ---------------------------------------------------------------------------
const updateCourseNameSchema = Joi.object({
  name:           Joi.string().trim().min(2).max(200).optional(),
  description:    Joi.string().max(2000).optional().allow('', null),
  status:         Joi.string().valid('ACTIVE', 'INACTIVE').optional(),
  isSystemDefault: Joi.forbidden(),
}).min(1);

// ---------------------------------------------------------------------------
// List / filter query schema
// ---------------------------------------------------------------------------
const listCourseNameQuerySchema = Joi.object({
  page:   Joi.number().integer().min(1).default(1),
  limit:  Joi.number().integer().min(1).max(100).default(10),
  search: Joi.string().trim().max(255).optional(),
  status: Joi.string().valid('ACTIVE', 'INACTIVE').optional(),
});

// ---------------------------------------------------------------------------
// Route-param schema: /:id (integer PK)
// ---------------------------------------------------------------------------
const courseNameIdParamSchema = Joi.object({
  id: Joi.number().integer().min(1).required(),
});

module.exports = {
  createCourseNameSchema,
  updateCourseNameSchema,
  listCourseNameQuerySchema,
  courseNameIdParamSchema,
};
