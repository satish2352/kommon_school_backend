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
 *
 * Allowed status values mirror the EnrollmentStatus + InternalPaymentStatus
 * enums the admin Status dropdown exposes. Anything outside the list is
 * rejected with a 422 so a stray query param can't silently match nothing.
 */
const ALLOWED_STATUS_VALUES = [
  // EnrollmentStatus
  'submitted',
  'payment_pending',
  'paid',
  'sync_pending',
  'completed',
  'failed',
  'cancelled',
  // InternalPaymentStatus (admin UI shows these on internal flow)
  'PAID',
  'PARTIAL',
  'PENDING',
  'FULLY_DISCOUNTED',
  // External sync state — Sync column filter
  'SYNC_PENDING',
  'SYNC_SUCCESS',
  'SYNC_FAILED',
  'SYNC_DEAD_LETTER',
];

const listEnrollmentsQuerySchema = Joi.object({
  page:     Joi.number().integer().min(1).default(1),
  // limit is capped server-side at MAX_LIMIT (100). Keeping a smaller
  // default (20) protects the table-render cost on the frontend.
  limit:    Joi.number().integer().min(1).max(100).default(20),
  search:   Joi.string().trim().max(200).allow('').optional(),
  status:   Joi.string().trim().valid(...ALLOWED_STATUS_VALUES, '').optional(),
  // External-sync-status filter (Sync column in the admin table). Mapped
  // separately in the service so a SYNC_FAILED query doesn't accidentally
  // filter on enrollments.status.
  externalSyncStatus: Joi.string().valid('PENDING', 'SUCCESS', 'FAILED', 'DEAD_LETTER').optional(),
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
