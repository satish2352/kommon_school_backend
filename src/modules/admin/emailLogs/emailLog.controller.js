'use strict';

const service = require('./emailLog.service');
const { sendSuccess } = require('../../../utils/ApiResponse');
const asyncHandler = require('../../../utils/asyncHandler');
const { HTTP } = require('../../../config/constants');

/**
 * GET /api/v1/admin/email-logs
 * Paginated audit log of transactional emails (recipient + status + time).
 */
const list = asyncHandler(async (req, res) => {
  const { rows, meta } = await service.listLogs(req.query, req.traceId);
  sendSuccess(res, HTTP.OK, rows, undefined, meta);
});

/**
 * POST /api/v1/admin/email-logs/resend
 * Body: { email }. (Re)sends onboarding credentials; resets the password for an
 * existing student account. Returns { to, accountAction, emailStatus, ... }.
 */
const resend = asyncHandler(async (req, res) => {
  const result = await service.resendOnboarding({
    email: req.body.email,
    actor: req.user,
    traceId: req.traceId,
  });
  const message = result.emailStatus === 'sent'
    ? 'Onboarding email resent'
    : `Resend ${result.emailStatus}`;
  sendSuccess(res, HTTP.OK, result, message);
});

module.exports = { list, resend };
