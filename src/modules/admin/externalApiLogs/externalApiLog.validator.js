'use strict';

const Joi = require('joi');

const listQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  sortBy: Joi.string().valid('created_at', 'updated_at').default('created_at'),
  sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
  status: Joi.string()
    .valid('pending', 'processing', 'success', 'failed', 'retrying', 'dead_letter')
    .optional(),
  enrollmentId: Joi.string().uuid().optional(),
  dateFrom: Joi.date().iso().optional(),
  dateTo: Joi.date().iso().optional(),
});

const idParamSchema = Joi.object({
  id: Joi.string().uuid().required(),
});

module.exports = { listQuerySchema, idParamSchema };
