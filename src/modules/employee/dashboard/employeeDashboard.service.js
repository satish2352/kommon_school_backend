'use strict';

const { getPrismaClient } = require('../../../config/database');
const logger = require('../../../config/logger');

// =============================================================================
// Employee Dashboard — derived metrics + recent activity for the
// follow-up portal landing page.
// -----------------------------------------------------------------------------
// All counts are filtered by `assigned_to = userId` server-side. The URL
// can never widen the scope — the only knob the caller passes is the JWT
// (which decodes to userId on the backend), so an employee cannot peek at
// another employee's numbers.
// =============================================================================

// Terminal follow-up statuses. An overdue date on a terminal followup is
// "stale" rather than "overdue" — the lead is closed out, no action
// needed. We exclude them from the overdue count so the badge doesn't
// nag forever after a conversion.
const TERMINAL_FOLLOWUP_STATUSES = [
  'payment_completed',
  'followup_closed',
  'converted',
  'lost',
  'closed',
];

/**
 * Build the dashboard payload for the requesting user.
 *
 * Single Promise.all so every count + the activity query goes out
 * simultaneously — the wall-clock is bounded by the slowest individual
 * query (typically <30ms on indexed columns), not the sum of them.
 *
 * @param {string} userId    — req.user.id
 * @param {string} [traceId] — for log correlation
 */
async function getDashboard(userId, traceId) {
  const db = getPrismaClient();

  // Use UTC day boundaries to keep counts stable regardless of which
  // timezone the API host sits in. Frontend may locale-format dates for
  // display; the buckets themselves are server-anchored.
  const now           = new Date();
  const startOfToday  = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(),
    0, 0, 0, 0,
  ));
  const endOfToday    = new Date(startOfToday.getTime() + 24 * 3600 * 1000);
  const sevenDaysOut  = new Date(now.getTime() + 7 * 24 * 3600 * 1000);

  // Common WHERE for "this employee's leads".
  const myEnrollment = { assigned_to: userId, deleted_at: null };

  const [
    totalAssigned,
    leadsWithFollowup,
    todaysFollowups,
    overdueFollowups,
    upcomingFollowups,
    statusCounts,
    recentNotes,
  ] = await Promise.all([
    // Total leads assigned to this user.
    db.enrollment.count({ where: myEnrollment }),

    // Leads that have AT LEAST one followup row. The difference
    // (totalAssigned - leadsWithFollowup) is the "untouched" count, which
    // we surface to the UI as "New leads" (no contact yet).
    db.enrollment.count({
      where: {
        ...myEnrollment,
        followups: { some: { deleted_at: null } },
      },
    }),

    // Today's follow-ups — scheduled for the current UTC day.
    db.followup.count({
      where: {
        enrollment:         myEnrollment,
        deleted_at:         null,
        next_followup_date: { gte: startOfToday, lt: endOfToday },
      },
    }),

    // Overdue — scheduled in the past, on a non-terminal followup.
    db.followup.count({
      where: {
        enrollment:         myEnrollment,
        deleted_at:         null,
        next_followup_date: { lt: now },
        status:             { notIn: TERMINAL_FOLLOWUP_STATUSES },
      },
    }),

    // Upcoming — within the next 7 days (excluding today which already
    // has its own tile).
    db.followup.count({
      where: {
        enrollment:         myEnrollment,
        deleted_at:         null,
        next_followup_date: { gte: endOfToday, lt: sevenDaysOut },
      },
    }),

    // Per-status counts. We groupBy on followup.status filtered to this
    // user's leads. Each status maps to a tile; the UI decides which to
    // surface and which to ignore.
    db.followup.groupBy({
      by:     ['status'],
      where:  { enrollment: myEnrollment, deleted_at: null },
      _count: { _all: true },
    }),

    // Recent activity — last 10 notes authored by this user across all
    // their followups. Gives the dashboard a "what did I just do" feed
    // without needing a separate audit page.
    db.followupNote.findMany({
      where:   { author_id: userId },
      orderBy: { created_at: 'desc' },
      take:    10,
      include: {
        followup: {
          select: {
            id:            true,
            enrollment_id: true,
            status:        true,
            enrollment: {
              select: {
                id:              true,
                email:           true,
                first_name:      true,
                last_name:       true,
                name:            true,
                enrollment_code: true,
              },
            },
          },
        },
      },
    }),
  ]);

  // Reshape statusCounts into a plain object so frontend code is
  // tile-key oriented rather than array-iteration-oriented.
  const byFollowupStatus = {};
  for (const row of statusCounts) {
    byFollowupStatus[row.status] = row._count._all;
  }

  // "New leads" = untouched + explicit followup.status='new'. Untouched is
  // the difference between total assigned and total with a followup; explicit
  // 'new' covers cases where the followup exists but the employee hasn't
  // moved it off the default yet.
  const untouched         = Math.max(0, totalAssigned - leadsWithFollowup);
  const newLeads          = untouched + (byFollowupStatus.new || 0);

  // Lookups that the dashboard tiles render directly. Default everything
  // to 0 so the UI doesn't have to deal with `undefined`.
  const interested        = byFollowupStatus.interested        || 0;
  const paymentPending    = byFollowupStatus.payment_pending   || 0;
  const paymentCompleted  = byFollowupStatus.payment_completed || 0;
  const converted         = byFollowupStatus.converted         || 0;
  const lost              = byFollowupStatus.lost              || 0;
  const closed            = (byFollowupStatus.closed || 0) + (byFollowupStatus.followup_closed || 0);
  const notInterested     = byFollowupStatus.not_interested    || 0;

  // Conversion rate: counted vs assigned. Returned as a 0..1 float; the UI
  // formats as %. Guarded against div-by-zero.
  const conversionRate = totalAssigned > 0
    ? (converted + paymentCompleted) / totalAssigned
    : 0;

  // Recent activity: shape just the fields the UI renders.
  const recentActivity = recentNotes.map((n) => {
    const e = n.followup?.enrollment;
    const leadName =
      e?.name ||
      [e?.first_name, e?.last_name].filter(Boolean).join(' ') ||
      e?.email ||
      'Unknown lead';
    return {
      id:           n.id,
      kind:         (n.metadata && n.metadata.kind) || 'note',
      body:         n.body,
      isSystem:     n.metadata && n.metadata.kind === 'system',
      enrollmentId: n.followup?.enrollment_id || null,
      leadName,
      leadEmail:    e?.email || null,
      createdAt:    n.created_at,
    };
  });

  logger.info({
    msg:     'employee_dashboard',
    traceId,
    user_id: userId,
    counts:  { totalAssigned, todaysFollowups, overdueFollowups, upcomingFollowups },
  });

  return {
    metrics: {
      totalAssigned,
      newLeads,
      todaysFollowups,
      overdueFollowups,
      upcomingFollowups,
      interested,
      paymentPending,
      paymentCompleted,
      converted,
      notInterested,
      lost,
      closed,
      conversionRate,
      // Raw breakdown for any UI that wants to render the full set.
      byFollowupStatus,
    },
    recentActivity,
  };
}

module.exports = { getDashboard };
