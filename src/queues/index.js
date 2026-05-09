'use strict';

const { buildWorker } = require('./workers/externalApi.worker');
const logger = require('../config/logger');

/**
 * Start all BullMQ workers.
 *
 * Called once after the HTTP server starts. Workers are lazy — they connect
 * to Redis internally and will not prevent the process from starting if Redis
 * is temporarily unreachable (ioredis retries automatically).
 *
 * @returns {{ workers: import('bullmq').Worker[] }}
 */
function startQueues() {
  const workers = [];

  try {
    const externalApiWorker = buildWorker();
    workers.push(externalApiWorker);
    logger.info({ msg: 'queues_started', workers: workers.length });
  } catch (err) {
    logger.error({ msg: 'queues_start_error', error: err.message });
    // Do not crash the process — queued jobs will process when Redis recovers
  }

  return { workers };
}

/**
 * Gracefully drain and close all workers.
 *
 * Each worker is given up to its internal close timeout (30 s default) to
 * finish in-flight jobs before the connection is dropped.
 *
 * @param {{ workers: import('bullmq').Worker[] }} param
 */
async function stopQueues({ workers }) {
  if (!workers || workers.length === 0) return;

  const closePromises = workers.map(async (worker) => {
    try {
      await worker.close();
      logger.info({ msg: 'worker_closed', name: worker.name });
    } catch (err) {
      logger.error({ msg: 'worker_close_error', name: worker.name, error: err.message });
    }
  });

  await Promise.allSettled(closePromises);
  logger.info({ msg: 'all_workers_closed' });
}

module.exports = { startQueues, stopQueues };
