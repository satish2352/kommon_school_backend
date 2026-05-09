'use strict';

const { Queue } = require('bullmq');
const { getQueueConnection } = require('./connection');
const { QUEUES } = require('../config/constants');
const logger = require('../config/logger');

let _queue = null;

function getQueue() {
  if (!_queue) {
    _queue = new Queue(QUEUES.EXTERNAL_API_SYNC, {
      connection: getQueueConnection(),
      defaultJobOptions: {
        attempts: 5,
        backoff: {
          type: 'exponential',
          delay: 30000, // 30 s base → attempts: 30s, 60s, 120s, 240s, 480s
        },
        removeOnComplete: { count: 1000 },
        removeOnFail: false,
      },
    });

    _queue.on('error', (err) => {
      logger.error({ msg: 'external_api_queue_error', error: err.message });
    });
  }

  return _queue;
}

/**
 * Enqueue an external-API sync job.
 *
 * jobId is set to the enrollmentId for idempotency — BullMQ will silently
 * discard duplicate enqueues for the same jobId while the job is still
 * waiting or active (edge case #11: double-click / double-webhook).
 *
 * @param {{ enrollmentId: string, paymentId: string, traceId: string }} payload
 */
async function enqueueExternalApiSync(payload) {
  const { enrollmentId, paymentId, traceId } = payload;

  if (!enrollmentId) {
    throw new Error('enqueueExternalApiSync: enrollmentId is required');
  }

  const job = await getQueue().add(
    'sync',
    { enrollmentId, paymentId, traceId },
    {
      // Use enrollmentId as jobId so duplicate enqueues are rejected by BullMQ.
      jobId: enrollmentId,
    },
  );

  logger.info({
    msg: 'external_api_sync_enqueued',
    traceId,
    enrollment_id: enrollmentId,
    payment_id: paymentId,
    job_id: job.id,
  });

  return job;
}

/**
 * Enqueue a retry for an external-API sync.
 *
 * Unlike enqueueExternalApiSync (which uses enrollmentId as jobId for
 * deduplication), this helper uses a random UUID jobId so it never collides
 * with the original job or previous retries, regardless of BullMQ job lifecycle
 * state. Used by the externalApiRetry cron which reschedules rows stuck in the
 * `retrying` DB state (e.g. after a Redis restart lost in-memory jobs).
 *
 * @param {{ enrollmentId: string, paymentId?: string, traceId?: string }} payload
 */
async function enqueueExternalApiRetry(payload) {
  const { enrollmentId, paymentId, traceId } = payload;

  if (!enrollmentId) {
    throw new Error('enqueueExternalApiRetry: enrollmentId is required');
  }

  const { v4: uuid } = require('uuid');
  const jobId = `retry-${uuid()}`;

  const job = await getQueue().add(
    'sync',
    { enrollmentId, paymentId, traceId },
    { jobId },
  );

  logger.info({
    msg: 'external_api_retry_enqueued',
    traceId,
    enrollment_id: enrollmentId,
    payment_id: paymentId,
    job_id: job.id,
  });

  return job;
}

module.exports = { getQueue, enqueueExternalApiSync, enqueueExternalApiRetry };
