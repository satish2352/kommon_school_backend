'use strict';

const Joi = require('joi');

// All valid FollowupStatus enum values — kept in sync with the Prisma schema.
const FOLLOWUP_STATUS_VALUES = [
  'payment_pending',
  'call_back_later',
  'interested',
  'not_interested',
  'payment_completed',
  'followup_closed',
  'invalid_number',
  'no_response',
];

/**
 * Query schema for GET /followups
 * Supports pagination, sorting, search, status, assignedTo, and date range.
 */
const listFollowupsQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  sortBy: Joi.string()
    .valid('created_at', 'updated_at', 'next_followup_date', 'status')
    .default('created_at'),
  sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
  search: Joi.string().trim().max(255).optional(),
  status: Joi.string().valid(...FOLLOWUP_STATUS_VALUES).optional(),
  assignedTo: Joi.string().uuid().optional(),
  dateFrom: Joi.date().iso().optional(),
  dateTo: Joi.date().iso().min(Joi.ref('dateFrom')).optional(),
});

/**
 * Body schema for PATCH /followups/:id/status
 * Validates new status and optional next_followup_date.
 */
const updateStatusSchema = Joi.object({
  status: Joi.string().valid(...FOLLOWUP_STATUS_VALUES).required(),
  next_followup_date: Joi.date().iso().optional(),
});

/**
 * Body schema for POST /followups/:id/notes
 */
const addNoteSchema = Joi.object({
  body: Joi.string().min(1).max(5000).required(),
  metadata: Joi.object().optional(),
});

/**
 * Params schema — reused for all routes that have :id in the path.
 */
const idParamSchema = Joi.object({
  id: Joi.string().uuid().required(),
});

module.exports = {
  FOLLOWUP_STATUS_VALUES,
  listFollowupsQuerySchema,
  updateStatusSchema,
  addNoteSchema,
  idParamSchema,
};
