'use strict';

const employeeService = require('./employee.service');
const asyncHandler = require('../../../utils/asyncHandler');
const { sendSuccess } = require('../../../utils/ApiResponse');
const { HTTP } = require('../../../config/constants');

// GET /api/v1/admin/employees
const list = asyncHandler(async (req, res) => {
  const data = await employeeService.listEmployees(req.query);
  sendSuccess(res, HTTP.OK, data, 'Employees listed');
});

// PATCH /api/v1/admin/enrollments/:id/assign
//   body: { employeeId: string|null, reason?: string }
//
// Mounted under the admin-enrollments routes file (not here) — this
// controller exposes the handler so the existing admin-enrollments
// route file can attach it without re-implementing the logic.
const assignEnrollment = asyncHandler(async (req, res) => {
  const data = await employeeService.assignEnrollment({
    enrollmentId: req.params.id,
    employeeId:   req.body.employeeId,
    reason:       req.body.reason,
    actorId:      req.user?.id,
    actorEmail:   req.user?.email,
    traceId:      req.traceId,
    ip:           req.ip,
    userAgent:    req.headers['user-agent'],
  });
  sendSuccess(
    res,
    HTTP.OK,
    data,
    req.body.employeeId ? 'Enrollment assigned' : 'Enrollment unassigned',
  );
});

// POST /api/v1/admin/enrollments/bulk-assign
const bulkAssign = asyncHandler(async (req, res) => {
  const data = await employeeService.bulkAssignEnrollments({
    enrollmentIds: req.body.enrollmentIds,
    employeeId:    req.body.employeeId,
    reason:        req.body.reason,
    actorId:       req.user?.id,
    actorEmail:    req.user?.email,
    traceId:       req.traceId,
    ip:            req.ip,
    userAgent:     req.headers['user-agent'],
  });
  sendSuccess(res, HTTP.OK, data, 'Bulk assignment completed');
});

module.exports = { list, assignEnrollment, bulkAssign };
