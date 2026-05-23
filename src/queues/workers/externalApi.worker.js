'use strict';

const { Worker } = require('bullmq');
const { getQueueConnection } = require('../connection');
const { QUEUES } = require('../../config/constants');
const { syncEnrollment } = require('../../modules/externalApi/external.service');
const externalRepo = require('../../modules/externalApi/external.repository');
const { getPrismaClient } = require('../../config/database');
const logger = require('../../config/logger');

/**
 * Load the enrollment and latest successful payment from the database.
 *
 * @param {string} enrollmentId
 * @param {string|undefined} paymentId
 * @returns {Promise<{ enrollment: object, payment: object|null }>}
 */
async function loadJobData(enrollmentId, paymentId) {
  const db = getPrismaClient();

  const enrollment = await db.enrollment.findFirst({
    where: { id: enrollmentId, deleted_at: null },
  });

  if (!enrollment) {
    throw new Error(`Enrollment not found: ${enrollmentId}`);
  }

  let payment = null;
  if (paymentId) {
    payment = await db.payment.findFirst({
      where: { id: paymentId },
    });
  }

  // Fallback: latest successful payment for this enrollment
  if (!payment) {
    payment = await db.payment.findFirst({
      where: { enrollment_id: enrollmentId, status: 'success' },
      orderBy: { created_at: 'desc' },
    });
  }

  return { enrollment, payment };
}

/**
 * Build a BullMQ Worker for the external-api-sync queue.
 *
 * Concurrency 5 — processes up to 5 jobs in parallel per worker instance.
 * Limiter: max 50 jobs/second across all workers (edge case #11 — rate limits
 * imposed by the external endpoint).
 */
function buildWorker() {
  const worker = new Worker(
    QUEUES.EXTERNAL_API_SYNC,
    async (job) => {
      const { enrollmentId, paymentId, traceId } = job.data;

      logger.info({
        msg: 'external_api_job_start',
        traceId,
        enrollment_id: enrollmentId,
        payment_id: paymentId,
        job_id: job.id,
        attempt: job.attemptsMade + 1,
        max_attempts: job.opts && job.opts.attempts,
      });

      const { enrollment, payment } = await loadJobData(enrollmentId, paymentId);

      await syncEnrollment({ enrollment, payment, traceId });

      logger.info({
        msg: 'external_api_job_done',
        traceId,
        enrollment_id: enrollmentId,
        job_id: job.id,
      });
    },
    {
      connection: getQueueConnection(),
      concurrency: 5,
      limiter: { max: 50, duration: 1000 },
    },
  );

  worker.on('completed', (job) => {
    logger.info({
      msg: 'external_api_job_completed',
      job_id: job.id,
      enrollment_id: job.data && job.data.enrollmentId,
    });
  });

  worker.on('failed', async (job, err) => {
    const traceId = job && job.data && job.data.traceId;
    const enrollmentId = job && job.data && job.data.enrollmentId;
    const maxAttempts = job && job.opts && job.opts.attempts;
    const attemptsMade = job ? job.attemptsMade : 0;

    logger.warn({
      msg: 'external_api_job_failed',
      traceId,
      enrollment_id: enrollmentId,
      job_id: job && job.id,
      attempt: attemptsMade,
      max_attempts: maxAttempts,
      error: err && err.message,
    });

    // If all attempts are exhausted, move to dead-letter state
    if (job && maxAttempts && attemptsMade >= maxAttempts) {
      try {
        const log = await externalRepo.findActiveLogForEnrollment(enrollmentId);
        if (log) {
          await externalRepo.markDeadLetter(log.id, err && err.message);
        }

        // Flag the enrollment's THIRD-PARTY sync state — NOT the
        // customer-facing `status` column. The customer paid; that's
        // a fact about the customer. Our inability to push them to the
        // external system is a fact about US, surfaced separately so
        // an admin can press "Retry sync" once the upstream issue
        // (dead webhook URL, rate-limit, etc.) is resolved.
        const enrollmentRepo = require('../../modules/enrollments/enrollment.repository');
        await enrollmentRepo.updateExternalSyncStatus(enrollmentId, 'DEAD_LETTER');

        logger.error({
          msg: 'external_api_dead_letter',
          traceId,
          enrollment_id: enrollmentId,
          job_id: job.id,
          error: err && err.message,
        });
      } catch (dlErr) {
        logger.error({
          msg: 'external_api_dead_letter_update_failed',
          traceId,
          enrollment_id: enrollmentId,
          error: dlErr.message,
        });
      }

      // Phase 2C: auto-create a marketing followup for dead-lettered enrollments.
      // Wrapped in a separate try/catch so followup failure never crashes the worker.
      try {
        const followupService = require('../../modules/followups/followup.service');
        await followupService.autoCreateFromDeadLetter({
          enrollmentId,
          reason: err && err.message,
          traceId,
        });
      } catch (fuErr) {
        logger.error({
          msg: 'followup_auto_create_failed',
          traceId,
          enrollment_id: enrollmentId,
          error: fuErr.message,
        });
      }
    }
  });

  worker.on('error', (err) => {
    logger.error({ msg: 'external_api_worker_error', error: err.message });
  });

  return worker;
}

module.exports = { buildWorker };
