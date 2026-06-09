'use strict';

const Joi = require('joi');

const listQuerySchema = Joi.object({
  page:   Joi.number().integer().min(1).default(1),
  limit:  Joi.number().integer().min(1).max(100).default(25),
  search: Joi.string().trim().max(255).allow('').optional(),
  status: Joi.string().valid('sent', 'failed', 'skipped').optional(),
  type:   Joi.string().trim().max(50).optional(),
});

const resendSchema = Joi.object({
  email: Joi.string().email().lowercase().trim().max(255).required(),
});

module.exports = { listQuerySchema, resendSchema };
