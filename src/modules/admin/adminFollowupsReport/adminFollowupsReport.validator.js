'use strict';

const Joi = require('joi');

const listFollowupsReportQuerySchema = Joi.object({
  page:       Joi.number().integer().min(1).default(1),
  limit:      Joi.number().integer().min(1).max(100).default(20),
  status:     Joi.string().trim().max(50).allow('').optional(),
  // When true, exclude terminal statuses (payment_completed / converted /
  // lost / closed / followup_closed) — used by the admin Follow-Ups page
  // default view so admins see actionable leads only.
  openOnly:   Joi.boolean().truthy('true').falsy('false').optional(),
  // Comma-separated FollowupStatus enum values to exclude from results.
  // Used by the admin Follow-Ups page to permanently hide statuses that
  // are out of scope for the module (payment_completed + lost). Distinct
  // from openOnly so callers can hide a specific subset without bringing
  // back terminal statuses they want to see.
  excludeStatuses: Joi.string().trim().max(500).optional(),
  // UUID OR special keyword (me / unassigned). Empty string = ignore.
  assignedTo: Joi.alternatives().try(
    Joi.string().uuid(),
    Joi.string().valid('me', 'unassigned', ''),
  ).optional(),
  dateFrom:   Joi.string().isoDate().optional(),
  dateTo:     Joi.string().isoDate().optional(),
}).options({ stripUnknown: true });

module.exports = { listFollowupsReportQuerySchema };
