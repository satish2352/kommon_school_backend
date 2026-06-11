'use strict';

const Joi = require('joi');

// 10-digit Indian mobile starting 6-9 — mirrors the public contact form.
const PHONE_REGEX = /^[6-9]\d{9}$/;
const STATUSES = ['NEW', 'READ', 'REPLIED', 'SPAM', 'ARCHIVED'];

// Public "Send Us a Message" submission. Limits match the frontend validation
// (message 10..1000 chars, name 2..100, valid email, mandatory 10-digit phone).
const createContactSchema = Joi.object({
  name:    Joi.string().trim().min(2).max(100).required(),
  email:   Joi.string().email().trim().lowercase().max(255).required(),
  phone:   Joi.string().trim().pattern(PHONE_REGEX).required().messages({
    'string.pattern.base': 'phone must be a 10-digit mobile number starting with 6, 7, 8, or 9',
  }),
  message: Joi.string().trim().min(10).max(1000).required(),
}).options({ stripUnknown: true });

const listContactQuerySchema = Joi.object({
  page:   Joi.number().integer().min(1).default(1),
  limit:  Joi.number().integer().min(1).max(100).default(10),
  search: Joi.string().trim().max(255).optional().allow(''),
  status: Joi.string().valid(...STATUSES).optional(),
});

const idParamSchema = Joi.object({
  id: Joi.string().uuid().required(),
});

const updateStatusSchema = Joi.object({
  status: Joi.string().valid(...STATUSES).required(),
});

module.exports = {
  createContactSchema,
  listContactQuerySchema,
  idParamSchema,
  updateStatusSchema,
};
