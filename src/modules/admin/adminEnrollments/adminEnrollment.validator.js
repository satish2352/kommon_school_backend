'use strict';

const Joi = require('joi');

/**
 * Query schema for GET /api/v1/admin/enrollments.
 *
 * IMPORTANT: every filter the frontend sends MUST be declared here.
 * The validate middleware sets `stripUnknown: true`, so any param not
 * listed below is silently dropped before the controller sees it.
 *
 * Two naming conventions are accepted because the existing
 * enrollment.service.listEnrollments treats them as interchangeable:
 *   - canonical: dateFrom / dateTo / candidateType
 *   - frontend aliases: fromDate / toDate / source
 * Both forms map to the same DB filter inside the service. The InternalEnrollments
 * + Enrollments admin pages currently send the alias names.
 *
 * Date values come from native <input type="date">, which produces a
 * YYYY-MM-DD string. CRITICAL: we use `.raw()` on every date field so
 * Joi validates the shape but does NOT convert the value into the
 * canonical "2026-05-17T00:00:00.000Z" datetime form. The downstream
 * service appends "T23:59:59.999" to `toDate` for inclusive end-of-day
 * filtering — that string append produces an invalid datetime
 * ("…T00:00:00.000ZT23:59:59.999") if Joi has already done its conversion,
 * which then makes Prisma throw a PrismaClientValidationError. Keeping
 * the input string as-typed avoids that round-trip.
 */
const listEnrollmentsQuerySchema = Joi.object({
  page:     Joi.number().integer().min(1).default(1),
  limit:    Joi.number().integer().min(1).max(100).default(20),
  search:   Joi.string().trim().max(200).allow('').optional(),
  status:   Joi.string().trim().max(50).allow('').optional(),
  // Canonical date params
  dateFrom: Joi.string().isoDate().raw().optional(),
  dateTo:   Joi.string().isoDate().raw().optional(),
  // Aliases sent by the admin frontend (<input type="date"> → YYYY-MM-DD)
  fromDate: Joi.string().isoDate().raw().optional(),
  toDate:   Joi.string().isoDate().raw().optional(),
  // Candidate-origin filter; both names are accepted by the service
  candidateType: Joi.string().valid('INTERNAL', 'EXTERNAL').optional(),
  source:        Joi.string().valid('INTERNAL', 'EXTERNAL').optional(),
  sortBy:   Joi.string().valid('created_at', 'updated_at', 'email', 'status').default('created_at'),
  sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
}).options({ stripUnknown: true });

module.exports = { listEnrollmentsQuerySchema };
