'use strict';

const enrollmentService = require('../../enrollments/enrollment.service');
const { sendSuccess } = require('../../../utils/ApiResponse');
const asyncHandler = require('../../../utils/asyncHandler');
const { HTTP } = require('../../../config/constants');
const { mapEnrollmentStatus } = require('../../../utils/transformAdmin');

/**
 * GET /api/v1/admin/enrollments
 * Paginated, searchable list of all enrollments for admin consumption.
 * Transforms snake_case DB rows into the camelCase shape the React frontend expects.
 */
const list = asyncHandler(async (req, res) => {
  const { rows, meta } = await enrollmentService.listEnrollments(req.query, req.traceId);

  const items = rows.map((r) => ({
    id:           r.id,
    enrollmentId: r.enrollment_code || r.id,
    fullName:
      r.name ||
      [`${r.first_name || ''}`.trim(), `${r.last_name || ''}`.trim()]
        .filter(Boolean)
        .join(' ') ||
      null,
    firstName:  r.first_name  || null,
    lastName:   r.last_name   || null,
    email:      r.email,
    phone:      r.phone_number || null,
    role:       r.user_role   || null,
    education:  r.education   || null,
    readiness:  r.readiness   || null,
    source:     r.source      || null,
    status:     mapEnrollmentStatus(r.status),
    createdAt:  r.created_at,
    updatedAt:  r.updated_at,
  }));

  sendSuccess(res, HTTP.OK, {
    items,
    total:      meta.total,
    page:       meta.page,
    limit:      meta.limit,
    totalPages: meta.totalPages,
  });
});

module.exports = { list };
