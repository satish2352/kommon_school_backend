'use strict';

const repo = require('./followup.repository');
const ApiError = require('../../utils/ApiError');
const logger = require('../../config/logger');
const { parsePagination, buildMeta } = require('../../utils/pagination');
const { getPrismaClient } = require('../../config/database');
const { ERROR_CODES } = require('../../config/constants');
const auditService = require('../audit/audit.service');

// Terminal statuses — no further status transitions allowed once reached.
const TERMINAL_STATUSES = ['payment_completed', 'followup_closed'];

// Valid FollowupStatus values — must stay in sync with the Prisma enum.
const FOLLOWUP_STATUSES = [
  'payment_pending',
  'call_back_later',
  'interested',
  'not_interested',
  'payment_completed',
  'followup_closed',
  'invalid_number',
  'no_response',
];

// Allowed sort fields for followup list queries.
const ALLOWED_SORT_FIELDS = ['created_at', 'updated_at', 'next_followup_date', 'status'];

/**
 * Auto-create a marketing followup when an enrollment hits the dead-letter queue.
 * Idempotent — if an active (non-closed) followup already exists for the enrollment,
 * the existing record is returned without creating a duplicate.
 *
 * @param {{ enrollmentId: string, reason: string, traceId: string }} opts
 * @returns {Promise<object>} — the followup (new or existing)
 */
async function autoCreateFromDeadLetter({ enrollmentId, reason, traceId }) {
  const existing = await repo.findActiveForEnrollment(enrollmentId);
  if (existing) {
    logger.info({
      msg: 'followup_auto_create_idempotent',
      traceId,
      enrollment_id: enrollmentId,
      followup_id: existing.id,
    });
    return existing;
  }

  const followup = await repo.createFollowup({
    enrollment_id: enrollmentId,
    status: 'payment_pending',
    reason: reason ? String(reason).slice(0, 255) : null,
  });

  logger.info({
    msg: 'followup_auto_created',
    traceId,
    enrollment_id: enrollmentId,
    followup_id: followup.id,
    reason,
  });

  return followup;
}

/**
 * Paginated list of followups with search, status filter, date range, and assignee filter.
 *
 * @param {object} query — raw query params from req.query
 * @param {string} traceId
 * @returns {Promise<{ rows: object[], meta: object }>}
 */
async function listFollowups(query, traceId, requestingUserId = null) {
  const { page, limit, skip, sortOrder, dateFrom, dateTo } = parsePagination(query);

  // Validate sort field against followup-specific allowed fields.
  const sortBy = ALLOWED_SORT_FIELDS.includes(query.sortBy) ? query.sortBy : 'created_at';

  const where = { deleted_at: null };

  if (query.status) {
    where.status = query.status;
  }

  // Lead-ownership filter (Employee Portal Phase 2). Accepts:
  //   "me"          → requestingUserId (employee portal shortcut)
  //   "unassigned"  → assigned_to IS NULL
  //   <UUID>        → specific employee
  if (query.assignedTo) {
    const v = String(query.assignedTo);
    if (v === 'me') {
      if (requestingUserId) where.assigned_to = requestingUserId;
    } else if (v === 'unassigned') {
      where.assigned_to = null;
    } else {
      where.assigned_to = v;
    }
  }

  if (dateFrom || dateTo) {
    where.created_at = {};
    if (dateFrom) where.created_at.gte = dateFrom;
    if (dateTo) where.created_at.lte = dateTo;
  }

  if (query.search) {
    const term = query.search.trim();
    // Search across the related enrollment's identity fields.
    where.enrollment = {
      OR: [
        { email: { contains: term, mode: 'insensitive' } },
        { first_name: { contains: term, mode: 'insensitive' } },
        { last_name: { contains: term, mode: 'insensitive' } },
        { phone_number: { contains: term } },
      ],
    };
  }

  const { rows, total } = await repo.listFollowups({
    skip,
    take: limit,
    where,
    orderBy: { [sortBy]: sortOrder },
  });

  logger.info({ msg: 'followup_list', traceId, total, page, limit });

  return { rows, meta: buildMeta(page, limit, total) };
}

/**
 * Return a followup with a synthesized timeline: notes + payment events for the
 * same enrollment, merged and sorted by created_at ascending.
 *
 * Phase 2D will add a proper audit_log table; for now, the timeline is built
 * from FollowupNote rows and Payment rows on the same enrollment.
 *
 * @param {string} id — followup id
 * @param {string} traceId
 * @returns {Promise<object>}
 */
async function getFollowupTimeline(id, traceId) {
  const followup = await repo.findFollowupById(id);
  if (!followup) {
    logger.warn({ msg: 'followup_not_found', traceId, followup_id: id });
    throw new ApiError(404, ERROR_CODES.FOLLOWUP_NOT_FOUND, 'Followup not found');
  }

  // Load payments for the same enrollment so we can build a unified timeline.
  const db = getPrismaClient();
  const payments = await db.payment.findMany({
    where: { enrollment_id: followup.enrollment_id },
    orderBy: { created_at: 'asc' },
    select: {
      id: true,
      status: true,
      amount: true,
      currency: true,
      razorpay_order_id: true,
      created_at: true,
      updated_at: true,
    },
  });

  // Build timeline entries.
  const timeline = [];

  // Entry 1: followup creation.
  timeline.push({
    kind: 'followup_created',
    timestamp: followup.created_at,
    data: {
      status: followup.status,
      reason: followup.reason,
    },
  });

  // Entries from notes (may include system notes for status changes).
  for (const note of followup.notes) {
    timeline.push({
      kind: note.metadata && note.metadata.kind === 'system' ? 'system_note' : 'note',
      timestamp: note.created_at,
      data: {
        id: note.id,
        body: note.body,
        author_id: note.author_id,
        metadata: note.metadata,
      },
    });
  }

  // Entries from payments on the same enrollment.
  for (const payment of payments) {
    timeline.push({
      kind: 'payment_event',
      timestamp: payment.created_at,
      data: {
        payment_id: payment.id,
        status: payment.status,
        amount: payment.amount,
        currency: payment.currency,
        order_id: payment.razorpay_order_id,
      },
    });
  }

  // Sort all entries chronologically.
  timeline.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  logger.info({
    msg: 'followup_timeline_fetched',
    traceId,
    followup_id: id,
    timeline_entries: timeline.length,
  });

  return { followup, timeline };
}

/**
 * Append a user-authored note to a followup.
 *
 * @param {{ followupId: string, authorId: string, body: string, metadata?: object, traceId: string }} opts
 * @returns {Promise<object>} — the created FollowupNote
 */
async function addNote({ followupId, authorId, body, metadata, traceId }) {
  // Verify the followup exists.
  const followup = await repo.findFollowupById(followupId);
  if (!followup) {
    logger.warn({ msg: 'followup_not_found', traceId, followup_id: followupId });
    throw new ApiError(404, ERROR_CODES.FOLLOWUP_NOT_FOUND, 'Followup not found');
  }

  const note = await repo.appendNote({
    followup_id: followupId,
    author_id: authorId,
    body,
    metadata: metadata || null,
  });

  logger.info({
    msg: 'followup_note_added',
    traceId,
    followup_id: followupId,
    note_id: note.id,
    author_id: authorId,
  });

  return note;
}

/**
 * Transition a followup to a new status.
 *
 * Terminal guard: if the followup is already in a terminal state
 * (payment_completed or followup_closed), reject with 409.
 * On transition to a terminal state, set closed_at = now().
 * Appends a system note recording the transition.
 *
 * @param {{ followupId: string, newStatus: string, actorId: string, traceId: string, nextFollowupDate?: Date }} opts
 * @returns {Promise<object>} — the updated followup
 */
async function updateStatus({ followupId, newStatus, actorId, traceId, nextFollowupDate, req }) {
  const followup = await repo.findFollowupById(followupId);
  if (!followup) {
    logger.warn({ msg: 'followup_not_found', traceId, followup_id: followupId });
    throw new ApiError(404, ERROR_CODES.FOLLOWUP_NOT_FOUND, 'Followup not found');
  }

  const fromStatus = followup.status;

  if (TERMINAL_STATUSES.includes(fromStatus)) {
    logger.warn({
      msg: 'followup_invalid_transition',
      traceId,
      followup_id: followupId,
      from_status: fromStatus,
      to_status: newStatus,
    });
    throw new ApiError(
      409,
      ERROR_CODES.FOLLOWUP_INVALID_TRANSITION,
      `Followup is already in terminal state '${fromStatus}' and cannot be updated`,
    );
  }

  const patch = { status: newStatus };

  if (TERMINAL_STATUSES.includes(newStatus)) {
    patch.closed_at = new Date();
  }

  if (nextFollowupDate !== undefined) {
    patch.next_followup_date = nextFollowupDate;
  }

  const updated = await repo.updateFollowup(followupId, patch);

  // Append a system note to record the status transition.
  await repo.appendNote({
    followup_id: followupId,
    author_id: actorId,
    body: `status changed: ${fromStatus} -> ${newStatus}`,
    metadata: { kind: 'system', from: fromStatus, to: newStatus },
  });

  logger.info({
    msg: 'followup_status_updated',
    traceId,
    followup_id: followupId,
    from_status: fromStatus,
    to_status: newStatus,
    actor_id: actorId,
  });

  await auditService.record({
    actor: { id: actorId },
    action: 'followup.status_change',
    entityType: 'followup',
    entityId: followupId,
    changes: { from: fromStatus, to: newStatus },
    req,
  });

  return updated;
}

/**
 * Trigger a payment retry for the enrollment linked to this followup.
 *
 * Guards:
 * - 409 FOLLOWUP_INVALID_TRANSITION if the followup is already terminal.
 * - 409 PAYMENT_ALREADY_COMPLETED if the enrollment is already paid/completed.
 *
 * On success, appends a system note and returns the Razorpay order details.
 *
 * The payment.service is required lazily here to avoid a circular-dependency
 * chain (followup.service -> payment.service -> enrollment.repo is fine;
 * a top-level require would not be circular but lazy load keeps module
 * initialization order predictable and is the safer pattern when services
 * can grow cross-dependencies over time).
 *
 * @param {{ followupId: string, actorId: string, traceId: string }} opts
 * @returns {Promise<object>} — Razorpay order details
 */
async function triggerPaymentRetry({ followupId, actorId, traceId, req }) {
  const followup = await repo.findFollowupById(followupId);
  if (!followup) {
    logger.warn({ msg: 'followup_not_found', traceId, followup_id: followupId });
    throw new ApiError(404, ERROR_CODES.FOLLOWUP_NOT_FOUND, 'Followup not found');
  }

  if (TERMINAL_STATUSES.includes(followup.status)) {
    throw new ApiError(
      409,
      ERROR_CODES.FOLLOWUP_INVALID_TRANSITION,
      `Followup is already in terminal state '${followup.status}'; cannot retry payment`,
    );
  }

  // Lazy require to keep module graph clean.
  const paymentService = require('../payments/payment.service');

  // createOrder already guards against paid/completed enrollment internally and
  // throws PAYMENT_ALREADY_COMPLETED. We let that bubble through unchanged.
  const orderDetails = await paymentService.createOrder(followup.enrollment_id, traceId);

  // Append a system note recording the retry action.
  await repo.appendNote({
    followup_id: followupId,
    author_id: actorId,
    body: 'payment retry triggered',
    metadata: {
      kind: 'system',
      order_id: orderDetails.orderId,
      payment_id: orderDetails.paymentId,
    },
  });

  logger.info({
    msg: 'followup_payment_retry_triggered',
    traceId,
    followup_id: followupId,
    enrollment_id: followup.enrollment_id,
    order_id: orderDetails.orderId,
    actor_id: actorId,
  });

  await auditService.record({
    actor: { id: actorId },
    action: 'followup.payment_retry',
    entityType: 'followup',
    entityId: followupId,
    changes: { order_id: orderDetails.orderId, enrollment_id: followup.enrollment_id },
    req,
  });

  return orderDetails;
}

module.exports = {
  FOLLOWUP_STATUSES,
  autoCreateFromDeadLetter,
  listFollowups,
  getFollowupTimeline,
  addNote,
  updateStatus,
  triggerPaymentRetry,
};
