'use strict';

const auditService = require('./audit.service');
const { sendSuccess } = require('../../utils/ApiResponse');
const asyncHandler = require('../../utils/asyncHandler');
const { HTTP } = require('../../config/constants');

/**
 * GET /api/v1/audit-logs
 * Paginated list of audit log entries. Admin and superadmin only.
 */
const list = asyncHandler(async (req, res) => {
  const { rows, meta } = await auditService.listAuditLogs(req.query, req.traceId);
  sendSuccess(res, HTTP.OK, rows, undefined, meta);
});

module.exports = { list };
