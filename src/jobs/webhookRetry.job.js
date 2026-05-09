'use strict';

/**
 * Webhook Retry Job
 * Schedule: every 3 minutes (cron string lives in src/jobs/index.js)
 *
 * Finds WebhookEvent rows that were not processed successfully on first
 * delivery (processed=false) and have fewer than WEBHOOK_RETRY_MAX_ATTEMPTS
 * attempts. Re-runs the business logic via replayEvent() from the webhook
 * controller so the retry path is identical to the live path.
 *
 * On success: sets processed=true, processed_at=now, increments attempts.
 * On failure: increments attempts only (leaves processed=false for next run).
 * After max attempts: the row is left unprocessed; an operator alert should
 * be fired by monitoring on `webhook_replay_max_attempts_reached`.
 *
 * Returns { replayed, succeeded, failed } counts for structured job logging.
 */

const { getPrismaClient } = require('../config/database');
const { replayEvent } = require('../modules/razorpay/webhook.controller');
const logger = require('../config/logger');

const MAX_ATTEMPTS = parseInt(process.env.WEBHOOK_RETRY_MAX_ATTEMPTS || '5', 10);
const BATCH_SIZE = parseInt(process.env.WEBHOOK_RETRY_BATCH_SIZE || '50', 10);

async function run() {
  const db = getPrismaClient();

  const rows = await db.webhookEvent.findMany({
    where: {
      processed: false,
      attempts: { lt: MAX_ATTEMPTS },
    },
    orderBy: { created_at: 'asc' },
    take: BATCH_SIZE,
  });

  const counts = { replayed: 0, succeeded: 0, failed: 0 };

  for (const row of rows) {
    counts.replayed++;
    const traceId = `webhook-retry:${row.id}`;

    try {
      await replayEvent({
        eventType: row.event_type,
        payload: row.payload,
        traceId,
      });

      await db.webhookEvent.update({
        where: { id: row.id },
        data: {
          processed: true,
          processed_at: new Date(),
          attempts: { increment: 1 },
        },
      });

      logger.info({
        msg: 'webhook_replay_succeeded',
        traceId,
        event_id: row.event_id,
        event_type: row.event_type,
        attempts: row.attempts + 1,
      });
      counts.succeeded++;
    } catch (err) {
      await db.webhookEvent.update({
        where: { id: row.id },
        data: { attempts: { increment: 1 } },
      });

      const newAttempts = row.attempts + 1;
      if (newAttempts >= MAX_ATTEMPTS) {
        logger.error({
          msg: 'webhook_replay_max_attempts_reached',
          traceId,
          event_id: row.event_id,
          event_type: row.event_type,
          attempts: newAttempts,
          error: err.message,
        });
      } else {
        logger.warn({
          msg: 'webhook_replay_failed',
          traceId,
          event_id: row.event_id,
          event_type: row.event_type,
          attempts: newAttempts,
          error: err.message,
        });
      }
      counts.failed++;
    }
  }

  return counts;
}

module.exports = { run };
