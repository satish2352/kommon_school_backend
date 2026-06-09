'use strict';

const Joi = require('joi');

// Roles admins can create / assign through the User Management UI.
// 'student' is provisioned via the public enrollment flow, never by admin —
// so it stays out of this list. 'employee' was added in Phase 1 for the
// Follow-Up Portal and is admin-managed alongside the other staff roles.
const ASSIGNABLE_ROLES = ['admin', 'marketing', 'superadmin', 'employee'];

const createUserSchema = Joi.object({
  email:    Joi.string().email().max(255).required(),
  password: Joi.string().min(8).max(128).required(),
  role:     Joi.string().valid(...ASSIGNABLE_ROLES).required(),
});

const updateUserSchema = Joi.object({
  role:     Joi.string().valid(...ASSIGNABLE_ROLES).optional(),
  // Setting `password` here doubles as the admin "Reset password" action.
  // The service hashes with bcrypt cost 12 before storing; the audit log
  // records `password_changed: true` (never the raw value).
  password: Joi.string().min(8).max(128).optional(),
}).min(1);

const listUsersQuerySchema = Joi.object({
  page:      Joi.number().integer().min(1).default(1),
  limit:     Joi.number().integer().min(1).max(100).default(20),
  sortBy:    Joi.string().valid('created_at', 'email', 'role').default('created_at'),
  sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
  search:    Joi.string().trim().max(200).optional(),
  role:      Joi.string().valid(...ASSIGNABLE_ROLES).optional(),
  status:    Joi.string().valid('active', 'deleted').optional(),
});

const idParamSchema = Joi.object({
  id: Joi.string().uuid().required(),
});

module.exports = {
  ASSIGNABLE_ROLES,
  createUserSchema,
  updateUserSchema,
  listUsersQuerySchema,
  idParamSchema,
};
