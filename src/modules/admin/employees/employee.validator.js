'use strict';

const Joi = require('joi');

// Minimal validator surface. The list endpoint takes no body; query is
// optional and only narrows results. The bulk-assign endpoint accepts an
// array of enrollment UUIDs + the target employee id (or null to clear).
const listEmployeesQuerySchema = Joi.object({
  // When true (default), filter out soft-deleted users. Set to false to
  // include deactivated employees (e.g. for an admin "all employees" view).
  activeOnly: Joi.boolean().truthy('true').falsy('false').default(true),
  // Optional search across email — for typeahead dropdowns.
  search:     Joi.string().trim().max(200).optional(),
  // Pagination caps; default is high because the picker UI loads "all"
  // employees in one shot.
  limit:      Joi.number().integer().min(1).max(500).default(200),
}).options({ stripUnknown: true });

// PATCH /api/v1/admin/enrollments/:id/assign
//   body: { employeeId: <uuid|null> }
// Setting employeeId to null clears the assignment (unassign).
const assignEnrollmentSchema = Joi.object({
  employeeId: Joi.string().uuid().allow(null).required(),
  // Optional admin-provided reason captured in the audit log entry.
  reason:     Joi.string().trim().max(500).optional().allow('', null),
});

// POST /api/v1/admin/enrollments/bulk-assign
//   body: { enrollmentIds: [<uuid>, ...], employeeId: <uuid|null>, reason? }
// Capped at 500 ids per request so a single transaction stays bounded.
const bulkAssignSchema = Joi.object({
  enrollmentIds: Joi.array()
    .items(Joi.string().uuid().required())
    .min(1)
    .max(500)
    .required(),
  employeeId:    Joi.string().uuid().allow(null).required(),
  reason:        Joi.string().trim().max(500).optional().allow('', null),
});

module.exports = {
  listEmployeesQuerySchema,
  assignEnrollmentSchema,
  bulkAssignSchema,
};
