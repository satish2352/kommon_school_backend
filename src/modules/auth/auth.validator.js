'use strict';

const Joi = require('joi');

const loginSchema = Joi.object({
  email:    Joi.string().email().lowercase().trim().required(),
  password: Joi.string().min(6).max(128).required(),
});

const refreshSchema = Joi.object({
  refreshToken: Joi.string().required(),
});

// Phase 3A: change-password endpoint
const changePasswordSchema = Joi.object({
  currentPassword: Joi.string().required(),
  newPassword:     Joi.string().min(8).max(128).required(),
});

module.exports = { loginSchema, refreshSchema, changePasswordSchema };
