'use strict';

/**
 * Enrollment Cleanup Job
 * Schedule: 0 2 * * *  (daily at 02:00)
 *
 * Marks enrollments that have been in `submitted` status for more than
 * ENROLLMENT_CLEANUP_STALE_HOURS (default 24 h) as `expired`.
 *
 * "Submitted" enrollments are those where a payment order was never created
 * (the student abandoned the form before clicking Pay). Expiring them keeps
 * the active enrollment list clean and prevents misleading pipeline counts.
 *
 * Prisma updateMany is safe here — no row-level lock needed because we are
 * only changing `submitted` rows and enrollment status is never written from
 * the HTTP path after the payment flow starts (status moves to payment_pending
 * at order creation time).
 *
 * Returns { expired } count for structured job logging.
 */

const { getPrismaClient } = require('../config/database');

// How long a submitted enrollment may be idle before it is expired
const STALE_HOURS = parseInt(process.env.ENROLLMENT_CLEANUP_STALE_HOURS || '24', 10);

async function run() {
  const db = getPrismaClient();

  const cutoff = new Date(Date.now() - STALE_HOURS * 60 * 60 * 1000);

  const result = await db.enrollment.updateMany({
    where: {
      status: 'submitted',
      created_at: { lt: cutoff },
      deleted_at: null,
    },
    data: { status: 'expired' },
  });

  return { expired: result.count };
}

module.exports = { run };
