'use strict';

const Joi = require('joi');

/**
 * Shared date range filter used by summary endpoints.
 * Both fields are optional. When both are present, dateTo must be >= dateFrom.
 */
const dateRangeQuerySchema = Joi.object({
  dateFrom: Joi.date().iso().optional(),
  dateTo: Joi.date().iso().min(Joi.ref('dateFrom')).optional(),
});

/**
 * Query schema for the export endpoint.
 * type is required and currently only 'payments' is accepted.
 * format defaults to 'csv'.
 */
const exportQuerySchema = Joi.object({
  type: Joi.string().valid('payments').required(),
  format: Joi.string().valid('csv').default('csv'),
  dateFrom: Joi.date().iso().optional(),
  dateTo: Joi.date().iso().min(Joi.ref('dateFrom')).optional(),
});

module.exports = { dateRangeQuerySchema, exportQuerySchema };
