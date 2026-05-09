'use strict';

const followupRepo = require('../../followups/followup.repository');
const { sendSuccess } = require('../../../utils/ApiResponse');
const asyncHandler = require('../../../utils/asyncHandler');
const { HTTP } = require('../../../config/constants');
const { parsePagination, buildMeta } = require('../../../utils/pagination');
const { pickEnrollmentSummary } = require('../../../utils/transformAdmin');
const logger = require('../../../config/logger');

/**
 * Map a raw Prisma followup row to the camelCase shape the React FollowUps page renders.
 *
 * Fields read by the page:
 *   f.id, f.enrollmentId, f.status, f.priority, f.callAttempts, f.nextFollowUpAt, f.lastContactAt
 *
 * @param {object} r
 * @returns {object}
 */
function toFollowupItem(r) {
  const enrollment = pickEnrollmentSummary(r.enrollment);
  return {
    id:            r.id,
    enrollmentId:  enrollment ? enrollment.enrollmentId : (r.enrollment_id || null),
    enrollment,
    status:        r.status ? r.status.toUpperCase() : null,
    priority:      r.priority     || null,
    callAttempts:  r.call_attempts ?? 0,
    nextFollowUpAt: r.next_followup_date || null,
    lastContactAt:  r.last_contact_at   || r.updated_at  || null,
    assignedTo:    r.assigned_to  || null,
    reason:        r.reason       || null,
    createdAt:     r.created_at,
    updatedAt:     r.updated_at,
  };
}

/**
 * GET /api/v1/admin/follow-ups/report
 * Paginated followup report for the admin panel.
 * Supports: page, limit, status, assignedTo, dateFrom, dateTo.
 */
const listReport = asyncHandler(async (req, res) => {
  const { page, limit, skip, dateFrom, dateTo } = parsePagination(req.query);

  const where = { deleted_at: null };

  if (req.query.status) {
    // Accept either UPPERCASE (frontend) or lowercase (internal); normalise to lowercase for DB
    where.status = req.query.status.toLowerCase();
  }

  if (req.query.assignedTo) {
    where.assigned_to = req.query.assignedTo;
  }

  if (dateFrom || dateTo) {
    where.created_at = {};
    if (dateFrom) where.created_at.gte = dateFrom;
    if (dateTo)   where.created_at.lte = dateTo;
  }

  const { rows, total } = await followupRepo.listFollowups({
    skip,
    take:    limit,
    where,
    orderBy: { created_at: 'desc' },
  });

  logger.info({ msg: 'admin_followups_report_listed', total, page, limit });

  sendSuccess(res, HTTP.OK, {
    items:      rows.map(toFollowupItem),
    total,
    page,
    limit,
    totalPages: buildMeta(page, limit, total).totalPages,
  });
});

module.exports = { listReport };
