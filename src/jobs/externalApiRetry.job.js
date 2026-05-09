'use strict';

/**
 * External API Retry Job
 * Schedule: every 2 minutes (cron string lives in src/jobs/index.js)
 *
 * Finds external_api_logs rows in `retrying` status whose next_attempt_at has
 * passed (or is null) and re-enqueues them via a UUID-keyed BullMQ job so they
 * don't collide with any existing job for that enrollment.
 *
 * This sweeper handles the case where BullMQ jobs were lost (Redis restart,
 * process crash) but the DB rows were already transitioned to `retrying` by a
 * previous worker run. Without this, those rows would be stuck indefinitely.
 *
 * Returns { scheduled } count for structured job logging.
 */

const { getPrismaClient } = require('../config/database');
const { enqueueExternalApiRetry } = require('../queues/externalApi.queue');
const logger = require('../config/logger');

// Maximum rows to reschedule in one sweep (prevents thundering herd on Redis restart)
const BATCH_SIZE = parseInt(process.env.EXTERNAL_API_RETRY_BATCH_SIZE || '50', 10);

async function run() {
  const db = getPrismaClient();
  const now = new Date();

  const rows = await db.externalApiLog.findMany({
    where: {
      status: 'retrying',
      OR: [
        { next_attempt_at: null },
        { next_attempt_at: { lte: now } },
      ],
    },
    orderBy: { next_attempt_at: 'asc' },
    take: BATCH_SIZE,
  });

  let scheduled = 0;

  for (const row of rows) {
    const traceId = `retry-sweep:${row.id}`;
    try {
      await enqueueExternalApiRetry({
        enrollmentId: row.enrollment_id,
        paymentId: row.payment_id || undefined,
        traceId,
      });
      scheduled++;
    } catch (err) {
      logger.error({
        msg: 'external_api_retry_enqueue_failed',
        traceId,
        log_id: row.id,
        enrollment_id: row.enrollment_id,
        error: err.message,
      });
    }
  }

  return { scheduled };
}

module.exports = { run };
