'use strict';

const Joi = require('joi');

const createUserSchema = Joi.object({
  email: Joi.string().email().max(255).required(),
  password: Joi.string().min(8).max(128).required(),
  role: Joi.string().valid('admin', 'marketing', 'superadmin').required(),
});

const updateUserSchema = Joi.object({
  role: Joi.string().valid('admin', 'marketing', 'superadmin').optional(),
  password: Joi.string().min(8).max(128).optional(),
}).min(1);

const listUsersQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  sortBy: Joi.string().valid('created_at', 'email', 'role').default('created_at'),
  sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
  search: Joi.string().trim().max(200).optional(),
  role: Joi.string().valid('admin', 'marketing', 'superadmin').optional(),
  status: Joi.string().valid('active', 'deleted').optional(),
});

const idParamSchema = Joi.object({
  id: Joi.string().uuid().required(),
});

module.exports = { createUserSchema, updateUserSchema, listUsersQuerySchema, idParamSchema };
