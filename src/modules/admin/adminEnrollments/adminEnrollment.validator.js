'use strict';

const Joi = require('joi');

const listEnrollmentsQuerySchema = Joi.object({
  page:     Joi.number().integer().min(1).default(1),
  limit:    Joi.number().integer().min(1).max(100).default(20),
  search:   Joi.string().trim().max(200).allow('').optional(),
  status:   Joi.string().trim().max(50).allow('').optional(),
  dateFrom: Joi.string().isoDate().optional(),
  dateTo:   Joi.string().isoDate().optional(),
  sortBy:   Joi.string().valid('created_at', 'updated_at', 'email', 'status').default('created_at'),
  sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
}).options({ stripUnknown: true });

module.exports = { listEnrollmentsQuerySchema };
