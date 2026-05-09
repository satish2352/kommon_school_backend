'use strict';

const Joi = require('joi');

const createConfigSchema = Joi.object({
  key_id: Joi.string().min(5).max(255).required(),
  key_secret: Joi.string().min(5).max(255).required(),
  webhook_secret: Joi.string().min(5).max(255).required(),
});

const idParamSchema = Joi.object({
  id: Joi.string().uuid().required(),
});

const listConfigsQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  sortBy: Joi.string().valid('created_at', 'updated_at').default('created_at'),
  sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
});

module.exports = { createConfigSchema, idParamSchema, listConfigsQuerySchema };
