'use strict';

const followupRepo = require('../../followups/followup.repository');
const contactService = require('../../contact/contact.service');
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
function toFollowupItem(r, contactByEmail = new Map()) {
  const enrollment = pickEnrollmentSummary(r.enrollment);
  // A lead originates from the public website when a contact submission exists
  // for its email (that table is only populated by the "Send Us a Message"
  // form). Otherwise it came from the enrollment flow. The website enquiry's
  // message becomes the description; enrollment leads fall back to the
  // follow-up's own reason.
  const email = (r.enrollment?.email || '').toLowerCase();
  const contactMessage = email ? contactByEmail.get(email) : null;
  const type = contactMessage != null ? 'website' : 'enrollment';
  const description = contactMessage ?? r.reason ?? null;
  // Lead ownership resolves in this priority:
  //   1. enrollment.assigned_to (canonical source - Phase 2 onwards)
  //   2. followup.assigned_to   (legacy dead-letter path; pre-Phase 2 rows)
  //   3. null
  // The follow-up's own assignee field is preserved because some old
  // dead-letter followups have it set but the underlying enrollment is
  // still unassigned. Most rows after Phase 2 read from #1.
  const ownerId      = r.enrollment?.assigned_to ?? r.assigned_to ?? null;
  const ownerUser    = r.enrollment?.assignee   ?? r.assignee     ?? null;
  return {
    id:            r.id,
    enrollmentId:  enrollment ? enrollment.enrollmentId : (r.enrollment_id || null),
    enrollment,
    status:        r.status ? r.status.toUpperCase() : null,
    priority:      r.priority     || null,
    callAttempts:  r.call_attempts ?? 0,
    nextFollowUpAt: r.next_followup_date || null,
    lastContactAt:  r.last_contact_at   || r.updated_at  || null,
    assignedTo:    ownerId,
    assignee:      ownerUser
      ? { id: ownerUser.id, email: ownerUser.email, role: ownerUser.role }
      : null,
    reason:        r.reason       || null,
    // Origin of the lead — 'website' (contact form) or 'enrollment'.
    type,
    // Human description: the website message, else the follow-up reason.
    description,
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

  // Status filter resolution, in priority order:
  //   1. explicit ?status=<value>                            (sharp filter)
  //   2. ?openOnly=true                                      (hide all 5 terminals)
  //   3. ?excludeStatuses=<csv>                              (subset exclusion)
  //   4. nothing                                             (return everything)
  //
  // The page-level "out of scope" list (payment_completed + lost) is
  // sent by the frontend on every request via excludeStatuses. openOnly
  // applies a STRICTER subset on top of it for the default OPEN view.
  if (req.query.status) {
    // Accept either UPPERCASE (frontend) or lowercase (internal); normalise to lowercase for DB
    where.status = req.query.status.toLowerCase();
  } else if (req.query.openOnly) {
    where.status = {
      notIn: ['payment_completed', 'followup_closed', 'converted', 'lost', 'closed'],
    };
  } else if (req.query.excludeStatuses) {
    const list = String(req.query.excludeStatuses)
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (list.length > 0) {
      where.status = { notIn: list };
    }
  }

  // Lead-ownership filter — UUID or special keyword (me / unassigned).
  // Filters on enrollment.assigned_to (the canonical source of lead
  // ownership), NOT followup.assigned_to (legacy dead-letter column).
  // Validator restricts to one of these three shapes; empty string is a
  // no-op so the frontend can send a cleared dropdown value verbatim.
  if (req.query.assignedTo) {
    const v = String(req.query.assignedTo);
    if (v === 'me') {
      if (req.user?.id) where.enrollment = { assigned_to: req.user.id };
    } else if (v === 'unassigned') {
      where.enrollment = { assigned_to: null };
    } else if (v !== '') {
      where.enrollment = { assigned_to: v };
    }
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

  // Enrich with website-origin detection + description. One batched query over
  // the page's emails maps each to its latest contact message (if any).
  const emails = rows.map((r) => r.enrollment?.email).filter(Boolean);
  const contactByEmail = new Map();
  try {
    const contacts = await contactService.findLatestMessagesByEmails(emails);
    for (const c of contacts) contactByEmail.set(String(c.email).toLowerCase(), c.message);
  } catch (err) {
    logger.warn({ msg: 'followups_contact_enrich_failed', error: err?.message || String(err) });
  }

  logger.info({ msg: 'admin_followups_report_listed', total, page, limit });

  sendSuccess(res, HTTP.OK, {
    items:      rows.map((r) => toFollowupItem(r, contactByEmail)),
    total,
    page,
    limit,
    totalPages: buildMeta(page, limit, total).totalPages,
  });
});

module.exports = { listReport };
