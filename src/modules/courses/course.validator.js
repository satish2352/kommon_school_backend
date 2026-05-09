'use strict';

const Joi = require('joi');

// ---------------------------------------------------------------------------
// Create schema — all required fields must be present
// ---------------------------------------------------------------------------
const createCourseSchema = Joi.object({
  nameOfCourseAsGroup: Joi.string().trim().min(2).max(200).required(),
  courseFee:           Joi.number().min(0).max(9999999.99).precision(2).required(),
  coupon:              Joi.string().trim().uppercase().max(50).optional().allow('', null),
  description:         Joi.string().max(2000).optional().allow('', null),
  status:              Joi.string().valid('ACTIVE', 'INACTIVE').optional(),
  educationId:         Joi.number().integer().positive().optional().allow(null),
  durationId:          Joi.number().integer().positive().optional().allow(null),
  isSystemDefault:     Joi.forbidden(),
});

// ---------------------------------------------------------------------------
// Update schema — all fields optional; same rules when present
// ---------------------------------------------------------------------------
const updateCourseSchema = Joi.object({
  nameOfCourseAsGroup: Joi.string().trim().min(2).max(200).optional(),
  courseFee:           Joi.number().min(0).max(9999999.99).precision(2).optional(),
  coupon:              Joi.string().trim().uppercase().max(50).optional().allow('', null),
  description:         Joi.string().max(2000).optional().allow('', null),
  status:              Joi.string().valid('ACTIVE', 'INACTIVE').optional(),
  educationId:         Joi.number().integer().positive().optional().allow(null),
  durationId:          Joi.number().integer().positive().optional().allow(null),
  isSystemDefault:     Joi.forbidden(),
}).min(1); // at least one field must be provided

// ---------------------------------------------------------------------------
// List / filter query schema
// ---------------------------------------------------------------------------
const listCourseQuerySchema = Joi.object({
  page:   Joi.number().integer().min(1).default(1),
  limit:  Joi.number().integer().min(1).max(100).default(10),
  search: Joi.string().trim().max(255).optional(),
  status: Joi.string().valid('ACTIVE', 'INACTIVE').optional(),
});

// ---------------------------------------------------------------------------
// Route-param schema: /:id (integer PK)
// ---------------------------------------------------------------------------
const courseIdParamSchema = Joi.object({
  id: Joi.number().integer().min(1).required(),
});

module.exports = {
  createCourseSchema,
  updateCourseSchema,
  listCourseQuerySchema,
  courseIdParamSchema,
};
