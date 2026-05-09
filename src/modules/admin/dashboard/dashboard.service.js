'use strict';

const { getPrismaClient } = require('../../../config/database');
const logger = require('../../../config/logger');

/**
 * Returns the admin dashboard summary counters.
 *
 * today.enrollments  — enrollments created since UTC midnight today, not soft-deleted
 * today.revenuePaise — SUM of successful payment amounts created since UTC midnight today
 * pending.payments   — payments whose status is 'initiated' or 'pending'
 * pending.followUps  — open followups (not payment_completed or followup_closed, not deleted)
 *
 * @returns {Promise<object>}
 */
async function getDashboardSummary() {
  const db = getPrismaClient();

  // UTC midnight today
  const todayUtcMidnight = new Date();
  todayUtcMidnight.setUTCHours(0, 0, 0, 0);

  const [
    todayEnrollments,
    todayRevenueAgg,
    pendingPayments,
    pendingFollowUps,
  ] = await Promise.all([
    // Enrollments created today (UTC)
    db.enrollment.count({
      where: {
        created_at: { gte: todayUtcMidnight },
        deleted_at: null,
      },
    }),

    // Sum of successful payments today
    db.payment.aggregate({
      _sum: { amount: true },
      where: {
        status: 'success',
        created_at: { gte: todayUtcMidnight },
      },
    }),

    // Payments in initiated/pending states (require action)
    db.payment.count({
      where: {
        status: { in: ['initiated', 'pending'] },
      },
    }),

    // Followups not yet closed or completed
    db.followup.count({
      where: {
        deleted_at: null,
        status: {
          notIn: ['payment_completed', 'followup_closed'],
        },
      },
    }),
  ]);

  const result = {
    today: {
      enrollments:  todayEnrollments,
      revenuePaise: todayRevenueAgg._sum.amount ?? 0,
    },
    pending: {
      payments:  pendingPayments,
      followUps: pendingFollowUps,
    },
  };

  logger.info({
    msg:  'dashboard_summary_fetched',
    today_enrollments: result.today.enrollments,
    today_revenue:     result.today.revenuePaise,
    pending_payments:  result.pending.payments,
    pending_followups: result.pending.followUps,
  });

  return result;
}

module.exports = { getDashboardSummary };
