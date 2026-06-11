'use strict';

const Joi = require('joi');

// Schemas for the /api/v1/employee/leads/* routes. Validation lives in
// this module rather than reusing the admin schemas because the employee
// surface is intentionally tighter — e.g. no date-range filters yet, no
// sort/limit knobs, no bulk operations.

// GET /employee/leads — pagination + simple text/status filters only.
const listLeadsQuerySchema = Joi.object({
  page:   Joi.number().integer().min(1).default(1),
  limit:  Joi.number().integer().min(1).max(100).default(20),
  // Free-text search across the student identity fields (email/name/phone).
  search: Joi.string().trim().max(200).allow('').optional(),
  // EnrollmentStatus value. Optional — empty means "any status".
  status: Joi.string().trim().max(40).allow('').optional(),
  // Follow-up status quick-filter (the user's day-to-day buckets).
  followupStatus: Joi.string().trim().max(40).allow('').optional(),
}).options({ stripUnknown: true });

// Param schema reused across :enrollmentId routes.
const enrollmentIdParamSchema = Joi.object({
  enrollmentId: Joi.string().uuid().required(),
});

// POST /employee/leads/:enrollmentId/notes
const addNoteSchema = Joi.object({
  body: Joi.string().trim().min(1).max(5000).required(),
  // Free-form metadata for note categorisation — UI sends 'kind' to
  // distinguish call/whatsapp/email/note. Validator stays liberal so
  // future kinds don't require a backend change.
  metadata: Joi.object().unknown(true).optional(),
}).options({ stripUnknown: true });

// PATCH /employee/leads/:enrollmentId/status — status OR next-followup
// can be sent independently (e.g. "I'll call them back Tuesday" only
// schedules a date, no status change yet). At least one field required.
const FOLLOWUP_STATUS_VALUES = [
  'payment_pending', 'call_back_later', 'interested', 'not_interested',
  'payment_completed', 'followup_closed', 'invalid_number', 'no_response',
  // Phase 1 enum extensions.
  'new', 'contacted', 'followup_scheduled', 'converted', 'lost', 'closed',
];
const updateStatusSchema = Joi.object({
  status:           Joi.string().valid(...FOLLOWUP_STATUS_VALUES).optional(),
  nextFollowupDate: Joi.date().iso().allow(null).optional(),
}).or('status', 'nextFollowupDate').options({ stripUnknown: true });

module.exports = {
  listLeadsQuerySchema,
  enrollmentIdParamSchema,
  addNoteSchema,
  updateStatusSchema,
};
