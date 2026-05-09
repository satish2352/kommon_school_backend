'use strict';

/**
 * Follow-up Reminder Job
 * Schedule: daily at 09:00 (UTC by default; override with CRON_TIMEZONE env var)
 *
 * Queries followups whose next_followup_date is in the past and that are not yet
 * closed or completed, have an assignee, and are not soft-deleted.
 * Groups results by assignee_id and logs a structured reminder entry per user.
 *
 * NOTE: No email or SMS is sent from this job. Notification transport
 * infrastructure is out of scope for Phase 2C and will be added in a later
 * phase. Marketing and ops teams monitor the structured log output for now.
 *
 * Returns { users_notified, total_due } for the distributed-lock job wrapper.
 */

const { getPrismaClient } = require('../config/database');
const logger = require('../config/logger');

async function run() {
  const db = getPrismaClient();
  const now = new Date();

  // Fetch all overdue, open, assigned followups.
  const dueFollowups = await db.followup.findMany({
    where: {
      deleted_at: null,
      assigned_to: { not: null },
      next_followup_date: { lte: now },
      status: {
        notIn: ['payment_completed', 'followup_closed'],
      },
    },
    select: {
      id: true,
      assigned_to: true,
      status: true,
      next_followup_date: true,
      enrollment_id: true,
    },
    orderBy: { next_followup_date: 'asc' },
  });

  if (dueFollowups.length === 0) {
    logger.info({ msg: 'followup_reminder_none_due' });
    return { users_notified: 0, total_due: 0 };
  }

  // Group by assignee_id.
  const byAssignee = {};
  for (const f of dueFollowups) {
    const uid = f.assigned_to;
    if (!byAssignee[uid]) {
      byAssignee[uid] = [];
    }
    byAssignee[uid].push(f.id);
  }

  const assigneeIds = Object.keys(byAssignee);

  // Log one structured entry per assignee so operations/marketing can triage.
  for (const assigneeId of assigneeIds) {
    const ids = byAssignee[assigneeId];
    logger.info({
      msg: 'followup_reminder_due',
      assignee_id: assigneeId,
      count: ids.length,
      ids,
    });
  }

  logger.info({
    msg: 'followup_reminder_complete',
    users_notified: assigneeIds.length,
    total_due: dueFollowups.length,
  });

  return { users_notified: assigneeIds.length, total_due: dueFollowups.length };
}

module.exports = { run };
