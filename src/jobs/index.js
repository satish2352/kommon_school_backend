'use strict';

/**
 * Cron Job Registry
 *
 * startJobs()  — schedules all 6 node-cron tasks, returns { tasks } for shutdown.
 * stopJobs()   — stops every task (calls task.stop() which prevents future ticks
 *                but does not interrupt a currently-running tick; the node process
 *                will drain naturally once the tick's async work completes).
 *
 * Each job runs inside withLock() to prevent the same job from executing
 * simultaneously on multiple process instances (horizontal scaling, PM2 cluster).
 * If the lock is already held the job logs "job_skipped" and returns immediately.
 *
 * Lock TTL is set to slightly longer than the expected maximum job runtime
 * to prevent a slow-but-alive job from having its lock stolen.
 */

const cron = require('node-cron');
const { withLock } = require('../utils/distributedLock');
const logger = require('../config/logger');

const paymentReconciliationJob = require('./paymentReconciliation.job');
const externalApiRetryJob = require('./externalApiRetry.job');
const enrollmentCleanupJob = require('./enrollmentCleanup.job');
const webhookRetryJob = require('./webhookRetry.job');
const followupReminderJob = require('./followupReminder.job');
const refreshTokenCleanupJob = require('./refreshTokenCleanup.job');

// Lock key prefix keeps job locks from colliding with application keys
const LOCK_PREFIX = 'lock:cron:';

// ---------------------------------------------------------------------------
// runJob — shared wrapper for every scheduled job
// ---------------------------------------------------------------------------

/**
 * Execute a job function under a distributed lock.
 *
 * Logs job_started, job_completed, job_skipped, or job_failed with duration_ms
 * and the result counts returned by the job function.
 *
 * @param {string}   name   — human-readable job name (used in log lines + lock key)
 * @param {number}   ttlMs  — distributed-lock TTL in ms
 * @param {Function} fn     — async function; should return an object of counts
 */
async function runJob(name, ttlMs, fn) {
  const lockKey = `${LOCK_PREFIX}${name}`;
  const start = Date.now();

  logger.info({ msg: 'job_started', job: name });

  let result;
  try {
    result = await withLock(lockKey, ttlMs, fn);
  } catch (err) {
    const duration_ms = Date.now() - start;
    logger.error({ msg: 'job_failed', job: name, duration_ms, error: err.message });
    return;
  }

  const duration_ms = Date.now() - start;

  if (result === null) {
    logger.info({ msg: 'job_skipped', job: name, duration_ms, reason: 'lock_held_by_another_instance' });
    return;
  }

  logger.info({ msg: 'job_completed', job: name, duration_ms, ...result });
}

// ---------------------------------------------------------------------------
// Job schedule definitions
// ---------------------------------------------------------------------------

const JOB_DEFINITIONS = [
  {
    name: 'payment_reconciliation',
    // Every 5 minutes — reconciles pending/initiated payments against Razorpay
    schedule: '*/5 * * * *',
    // TTL: 4 min 30 s — safe headroom below the 5-min tick interval
    lockTtlMs: 4.5 * 60 * 1000,
    fn: () => paymentReconciliationJob.run(),
  },
  {
    name: 'external_api_retry',
    // Every 2 minutes — reschedules retrying external_api_logs rows
    schedule: '*/2 * * * *',
    // TTL: 1 min 45 s
    lockTtlMs: 1.75 * 60 * 1000,
    fn: () => externalApiRetryJob.run(),
  },
  {
    name: 'enrollment_cleanup',
    // Daily at 02:00 — expires stale submitted enrollments
    schedule: '0 2 * * *',
    // TTL: 10 min — cleanup query should never take longer than this
    lockTtlMs: 10 * 60 * 1000,
    fn: () => enrollmentCleanupJob.run(),
  },
  {
    name: 'webhook_retry',
    // Every 3 minutes — replays failed webhook events
    schedule: '*/3 * * * *',
    // TTL: 2 min 45 s
    lockTtlMs: 2.75 * 60 * 1000,
    fn: () => webhookRetryJob.run(),
  },
  {
    name: 'followup_reminder',
    // Daily at 09:00 — Phase 2C stub (no-op until followups table exists)
    schedule: '0 9 * * *',
    // TTL: 5 min — minimal since it's a no-op
    lockTtlMs: 5 * 60 * 1000,
    fn: () => followupReminderJob.run(),
  },
  {
    name: 'refresh_token_cleanup',
    // Daily at 03:00 — purges old expired/revoked refresh tokens
    schedule: '0 3 * * *',
    // TTL: 10 min
    lockTtlMs: 10 * 60 * 1000,
    fn: () => refreshTokenCleanupJob.run(),
  },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Schedule all cron jobs.
 *
 * node-cron tasks are created with scheduled=true (they start immediately).
 * Each task fires runJob() which acquires the distributed lock before executing
 * the job function.
 *
 * @returns {{ tasks: import('node-cron').ScheduledTask[] }}
 */
function startJobs() {
  const tasks = [];

  for (const def of JOB_DEFINITIONS) {
    if (!cron.validate(def.schedule)) {
      logger.error({ msg: 'job_invalid_schedule', job: def.name, schedule: def.schedule });
      continue;
    }

    const task = cron.schedule(
      def.schedule,
      () => {
        // Fire-and-forget: errors are caught inside runJob; the cron tick must
        // not throw or node-cron will suppress future ticks for this task.
        runJob(def.name, def.lockTtlMs, def.fn).catch((err) => {
          logger.error({ msg: 'job_unhandled_error', job: def.name, error: err.message });
        });
      },
      {
        scheduled: true,
        // Use UTC internally so the schedule is timezone-agnostic across deployments.
        // Override with CRON_TIMEZONE env if the school requires local time.
        timezone: process.env.CRON_TIMEZONE || 'UTC',
      },
    );

    tasks.push(task);
    logger.info({ msg: 'job_scheduled', job: def.name, schedule: def.schedule });
  }

  logger.info({ msg: 'jobs_started', count: tasks.length });
  return { tasks };
}

/**
 * Stop all scheduled cron tasks.
 *
 * task.stop() prevents future ticks but does not interrupt a currently-running
 * tick. In-flight async work will complete naturally before the process exits
 * (the graceful shutdown timeout in server.js gives 15 s for this).
 *
 * @param {{ tasks: import('node-cron').ScheduledTask[] }} param
 */
function stopJobs({ tasks }) {
  if (!tasks || tasks.length === 0) return;

  for (const task of tasks) {
    try {
      task.stop();
    } catch (err) {
      logger.error({ msg: 'job_stop_error', error: err.message });
    }
  }

  logger.info({ msg: 'jobs_stopped', count: tasks.length });
}

module.exports = { startJobs, stopJobs };
