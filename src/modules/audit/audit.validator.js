'use strict';

const Joi = require('joi');

const listAuditLogQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  sortBy: Joi.string().valid('created_at').default('created_at'),
  sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
  search: Joi.string().trim().max(200).optional(),
  action: Joi.string().trim().max(100).optional(),
  entityType: Joi.string().trim().max(100).optional(),
  entityId: Joi.string().uuid().optional(),
  actorId: Joi.string().uuid().optional(),
  dateFrom: Joi.date().iso().optional(),
  dateTo: Joi.date().iso().optional(),
});

module.exports = { listAuditLogQuerySchema };
