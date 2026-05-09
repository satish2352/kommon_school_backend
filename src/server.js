'use strict';

const app = require('./app');
const env = require('./config/env');
const logger = require('./config/logger');
const { getPrismaClient, disconnectPrisma } = require('./config/database');
const { disconnectRedis } = require('./config/redis');
const { startQueues, stopQueues } = require('./queues');
const { startJobs, stopJobs } = require('./jobs');

const port = env.PORT;

const server = app.listen(port, () => {
  logger.info({ msg: 'server_started', port, env: env.NODE_ENV });
});

server.keepAliveTimeout = 65 * 1000;
server.headersTimeout = 66 * 1000;

// Start BullMQ workers after HTTP server is bound.
// Workers connect to Redis lazily; a Redis outage at startup does not
// prevent the HTTP server from accepting requests.
const queueHandles = startQueues();

// Start cron jobs after queues are up. Jobs use Redis-backed distributed locks
// so they require Redis to be reachable. Errors inside individual job ticks are
// caught and logged without crashing the process.
const jobHandles = startJobs();

let shuttingDown = false;

async function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ msg: 'shutdown_initiated', signal });

  const forceExit = setTimeout(() => {
    logger.error({ msg: 'shutdown_forced_after_timeout' });
    process.exit(1);
  }, 15000); // increased to 15 s to allow worker drain
  forceExit.unref();

  server.close(async (err) => {
    if (err) {
      logger.error({ msg: 'http_close_error', error: err.message });
    } else {
      logger.info({ msg: 'http_closed' });
    }

    // Stop cron schedulers (prevents future ticks; in-flight ticks drain naturally)
    try {
      stopJobs(jobHandles);
    } catch (e) {
      logger.error({ msg: 'jobs_stop_error', error: e.message });
    }

    // Drain in-flight BullMQ jobs before closing DB/Redis
    try {
      await stopQueues(queueHandles);
    } catch (e) {
      logger.error({ msg: 'queue_stop_error', error: e.message });
    }

    try {
      await disconnectPrisma();
      logger.info({ msg: 'prisma_disconnected' });
    } catch (e) {
      logger.error({ msg: 'prisma_disconnect_error', error: e.message });
    }

    try {
      await disconnectRedis();
    } catch (e) {
      logger.error({ msg: 'redis_disconnect_error', error: e.message });
    }

    clearTimeout(forceExit);
    process.exit(err ? 1 : 0);
  });
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

process.on('unhandledRejection', (reason) => {
  logger.error({ msg: 'unhandled_rejection', reason: reason && reason.message ? reason.message : String(reason) });
});

process.on('uncaughtException', (err) => {
  logger.error({ msg: 'uncaught_exception', error: err.message, stack: err.stack });
  gracefulShutdown('uncaughtException');
});

// Eagerly initialise Prisma so connection errors surface during startup.
getPrismaClient();
