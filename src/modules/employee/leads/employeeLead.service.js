'use strict';

const { getPrismaClient } = require('../../../config/database');
const ApiError = require('../../../utils/ApiError');
const logger = require('../../../config/logger');
const { parsePagination, buildMeta } = require('../../../utils/pagination');

const enrollmentRepo = require('../../enrollments/enrollment.repository');
const followupService = require('../../followups/followup.service');
const followupRepo = require('../../followups/followup.repository');

// =============================================================================
// Employee Follow-Up Portal — leads service
// -----------------------------------------------------------------------------
// All endpoints below are gated by LEADS_VIEW_OWN at the route layer AND
// enforce per-row ownership here: an employee can only see/act on an
// enrollment whose assigned_to == req.user.id. Admins (LEADS_VIEW_ALL)
// bypass the ownership check because they have legitimate cross-employee
// visibility for monitoring + reassignment.
// =============================================================================

/**
 * Ownership / visibility guard for a specific enrollment.
 *
 * Returns the enrollment when the caller is allowed to see it. Throws:
 *   404 — enrollment doesn't exist (or is soft-deleted).
 *   403 — the caller is an employee but not the assignee.
 *
 * Admins / superadmins bypass the assignee check. Marketing is treated as
 * employee for visibility scoping here even though they retain admin-level
 * permissions elsewhere — visibility on /employee/* is strictly by ownership.
 */
async function loadOwnedEnrollment(enrollmentId, requestingUser) {
  const db = getPrismaClient();
  const enrollment = await db.enrollment.findFirst({
    where:  { id: enrollmentId, deleted_at: null },
    include: {
      assignee:      { select: { id: true, email: true, role: true } },
      plan_pricing:  { include: { plan: true } },
      internal_plan: { include: { course: true } },
      payments:      { orderBy: { created_at: 'desc' } },
    },
  });
  if (!enrollment) throw ApiError.notFound('Lead not found');

  // Caller scoping. Superadmin/admin can see anything; an employee can
  // only see their own. Marketing falls into the same scoping as employee
  // when hitting /employee/* (they have their own /admin/follow-ups view).
  const role = String(requestingUser?.role || '').toLowerCase();
  const isPrivileged = role === 'superadmin' || role === 'admin';
  if (!isPrivileged) {
    if (enrollment.assigned_to !== requestingUser?.id) {
      throw ApiError.forbidden('You are not assigned to this lead');
    }
  }
  return enrollment;
}

/**
 * Paginated list of leads the requesting user owns.
 *
 * Mirrors the shape returned by /admin/enrollments/grouped so the frontend
 * can reuse its row-rendering code, but the WHERE clause is locked to
 * `assigned_to = req.user.id` server-side — the URL/query cannot widen it.
 *
 * @param {object} query — validated query params (page/limit/search/status/followupStatus)
 * @param {string} userId — req.user.id (from the JWT)
 * @param {string} traceId
 */
async function listMyLeads(query, userId, traceId) {
  const { page, limit, skip } = parsePagination(query);

  const where = {
    deleted_at:  null,
    // Hard-bound to the caller — no way to widen via query param.
    assigned_to: userId,
  };

  // Status filter (enrollment lifecycle status). Optional, blank = all.
  if (query.status && query.status.trim()) {
    where.status = query.status.trim();
  }

  // Follow-up status quick-filter — translates to a relation filter on
  // the most recent followup. Empty / missing = no constraint.
  if (query.followupStatus && query.followupStatus.trim()) {
    where.followups = {
      some: {
        status:     query.followupStatus.trim(),
        deleted_at: null,
      },
    };
  }

  // Search across student identity. <3 chars are silently dropped to keep
  // trigram indexes effective (mirrors the admin list's behaviour).
  if (query.search && query.search.trim()) {
    const term = query.search.trim();
    const isNumeric = /^\+?\d+$/.test(term);
    if (isNumeric) {
      where.phone_number = { startsWith: term.replace(/^\+/, '') };
    } else if (term.length >= 3) {
      where.OR = [
        { email:      { contains: term, mode: 'insensitive' } },
        { first_name: { contains: term, mode: 'insensitive' } },
        { last_name:  { contains: term, mode: 'insensitive' } },
        { name:       { contains: term, mode: 'insensitive' } },
      ];
    }
  }

  const { rows, total } = await enrollmentRepo.listEnrollments({
    skip,
    take: limit,
    where,
    orderBy: { created_at: 'desc' },
  });

  // Eager-load the latest followup per enrollment so the row can show
  // status / nextFollowupDate without a per-row round-trip. Batched in
  // one query for the whole page.
  const db = getPrismaClient();
  const enrollmentIds = rows.map((r) => r.id);
  const followupByEnrollment = new Map();
  if (enrollmentIds.length > 0) {
    const followups = await db.followup.findMany({
      where: { enrollment_id: { in: enrollmentIds }, deleted_at: null },
      orderBy: { created_at: 'desc' },
      select: {
        id:                 true,
        enrollment_id:      true,
        status:             true,
        next_followup_date: true,
        updated_at:         true,
      },
    });
    for (const f of followups) {
      if (!followupByEnrollment.has(f.enrollment_id)) {
        // First (most recent) wins.
        followupByEnrollment.set(f.enrollment_id, f);
      }
    }
  }

  const items = rows.map((r) => ({
    id:                r.id,
    enrollmentCode:    r.enrollment_code || r.id,
    fullName:
      r.name ||
      [`${r.first_name || ''}`.trim(), `${r.last_name || ''}`.trim()]
        .filter(Boolean).join(' ') || null,
    email:             r.email,
    phone:             r.phone_number || null,
    status:            r.status,
    candidateType:     r.candidate_type || 'EXTERNAL',
    amountPaise:       r.final_amount_paise ?? r.amount ?? null,
    createdAt:         r.created_at,
    updatedAt:         r.updated_at,
    // Snapshot of the latest followup (drives the day-to-day status pill
    // on each row). Null when no followup has been created yet — that's
    // a "fresh" lead waiting for the employee's first touch.
    followup:          followupByEnrollment.get(r.id) ?? null,
  }));

  logger.info({ msg: 'employee_leads_listed', traceId, userId, total, page, limit });
  return { items, meta: buildMeta(page, limit, total) };
}

/**
 * Detail view for a single owned lead. Returns the enrollment + the
 * canonical (most recent) followup + its notes timeline.
 *
 * Idempotent w.r.t. followup creation: this is a READ. The followup is
 * lazily created when the employee takes their first action (add note,
 * change status, schedule). That keeps the timeline clean — a fresh
 * never-touched lead has no followup row.
 */
async function getLeadDetail(enrollmentId, requestingUser, traceId) {
  const enrollment = await loadOwnedEnrollment(enrollmentId, requestingUser);

  const db = getPrismaClient();
  const followup = await db.followup.findFirst({
    where:  { enrollment_id: enrollmentId, deleted_at: null },
    orderBy: { created_at: 'desc' },
    include: {
      notes: {
        orderBy: { created_at: 'asc' },
        include: {
          author: { select: { id: true, email: true, role: true } },
        },
      },
    },
  });

  logger.info({
    msg:           'employee_lead_detail',
    traceId,
    user_id:       requestingUser.id,
    enrollment_id: enrollmentId,
    has_followup:  Boolean(followup),
  });

  return { enrollment, followup };
}

/**
 * Add a note to a lead. Creates the underlying followup record on the
 * caller's first action, so the employee never has to "start working" a
 * lead as an extra step — they just add a note and the system links it
 * to a followup transparently.
 */
async function addNote({ enrollmentId, body, metadata, requestingUser, traceId }) {
  await loadOwnedEnrollment(enrollmentId, requestingUser);

  // Reuse the existing autoCreateFromDeadLetter — name is historical
  // (it was first introduced for the dead-letter path); semantically it's
  // a generic "ensure a followup row exists for this enrollment".
  const followup = await followupService.autoCreateFromDeadLetter({
    enrollmentId,
    reason:  null,
    traceId,
  });

  const note = await followupService.addNote({
    followupId: followup.id,
    authorId:   requestingUser.id,
    body,
    metadata:   metadata || null,
    traceId,
  });

  return { followupId: followup.id, note };
}

/**
 * Update lead status and/or schedule the next follow-up. At least one of
 * { status, nextFollowupDate } must be present (validator enforced).
 *
 * Creates the followup on first call (same pattern as addNote). When only
 * scheduling without changing status, we pass through the current status
 * to the existing updateStatus service — it accepts a no-op transition
 * silently so the schedule-only path doesn't need a separate code path.
 */
async function updateStatusAndSchedule({
  enrollmentId,
  status,
  nextFollowupDate,
  requestingUser,
  traceId,
  req,
}) {
  await loadOwnedEnrollment(enrollmentId, requestingUser);

  const followup = await followupService.autoCreateFromDeadLetter({
    enrollmentId,
    reason: null,
    traceId,
  });

  // If the caller only sent nextFollowupDate, keep the existing status.
  const targetStatus = status || followup.status;

  const updated = await followupService.updateStatus({
    followupId:        followup.id,
    newStatus:         targetStatus,
    actorId:           requestingUser.id,
    nextFollowupDate:  nextFollowupDate ?? null,
    traceId,
    req,
  });

  return updated;
}

module.exports = {
  loadOwnedEnrollment,
  listMyLeads,
  getLeadDetail,
  addNote,
  updateStatusAndSchedule,
};
