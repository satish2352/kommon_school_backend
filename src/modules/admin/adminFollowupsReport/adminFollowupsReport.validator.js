'use strict';

const Joi = require('joi');

const listFollowupsReportQuerySchema = Joi.object({
  page:       Joi.number().integer().min(1).default(1),
  limit:      Joi.number().integer().min(1).max(100).default(20),
  status:     Joi.string().trim().max(50).allow('').optional(),
  // UUID OR special keyword (me / unassigned). Empty string = ignore.
  assignedTo: Joi.alternatives().try(
    Joi.string().uuid(),
    Joi.string().valid('me', 'unassigned', ''),
  ).optional(),
  dateFrom:   Joi.string().isoDate().optional(),
  dateTo:     Joi.string().isoDate().optional(),
}).options({ stripUnknown: true });

module.exports = { listFollowupsReportQuerySchema };
