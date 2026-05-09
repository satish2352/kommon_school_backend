'use strict';

const logService = require('./externalApiLog.service');
const { sendSuccess } = require('../../../utils/ApiResponse');
const asyncHandler = require('../../../utils/asyncHandler');
const { HTTP } = require('../../../config/constants');
const { mapExternalApiStatus, pickEnrollmentSummary } = require('../../../utils/transformAdmin');

/**
 * Transform a raw ExternalApiLog row to the camelCase shape the React admin
 * frontend expects.
 *
 * @param {object} r — raw Prisma ExternalApiLog row
 * @returns {object}
 */
function toLogItem(r) {
  return {
    id:           r.id,
    enrollmentId: r.enrollment
      ? (r.enrollment.enrollment_code || r.enrollment.id)
      : (r.enrollment_id || null),
    enrollment:   pickEnrollmentSummary(r.enrollment || null),
    status:       mapExternalApiStatus(r.status),
    attempts:     r.attempts    ?? 0,
    statusCode:   r.status_code ?? null,
    lastError:    r.last_error  ?? null,
    durationMs:   r.duration_ms ?? null,
    endpoint:     r.endpoint    || null,
    createdAt:    r.created_at,
    updatedAt:    r.updated_at,
  };
}

/**
 * GET /api/v1/admin/external-api-logs
 * Paginated list of external API sync logs (camelCase response).
 */
const list = asyncHandler(async (req, res) => {
  const { rows, meta } = await logService.listLogs(req.query);

  sendSuccess(res, HTTP.OK, {
    items:      rows.map(toLogItem),
    total:      meta.total,
    page:       meta.page,
    limit:      meta.limit,
    totalPages: meta.totalPages,
  });
});

/**
 * GET /api/v1/admin/external-api-logs/:id
 * Single log entry with full request/response payloads.
 */
const getById = asyncHandler(async (req, res) => {
  const log = await logService.getLogById(req.params.id);
  sendSuccess(res, HTTP.OK, toLogItem(log));
});

module.exports = { list, getById };
