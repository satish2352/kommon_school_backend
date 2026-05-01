import 'dotenv/config';
import http from 'http';
import { env } from '@/config/env';
import { logger } from '@/config/logger';
import { createApp } from '@/app';
import { loadDependencies, unloadDependencies } from '@/loaders/db.loader';

let server: http.Server;
let isShuttingDown = false;

async function bootstrap(): Promise<void> {
  // Load DB + Redis (graceful degradation if unavailable)
  await loadDependencies();

  const app = createApp();
  server = http.createServer(app);

  // ── Start listening ────────────────────────────────────────
  server.listen(env.PORT, () => {
    logger.info(
      {
        port: env.PORT,
        env: env.NODE_ENV,
        version: env.API_VERSION,
        docs: `http://localhost:${env.PORT}/api/docs`,
        health: `http://localhost:${env.PORT}/api/${env.API_VERSION}/health`,
      },
      `Kommon School API started on port ${env.PORT}`,
    );

    // Start BullMQ workers and cron jobs after server is listening.
    // Dynamic imports avoid circular dependency issues and allow graceful
    // degradation if Redis is unavailable.
    if (env.QUEUE_ENABLED) {
      import('@/jobs/workers')
        .then(({ startWorkers }) => {
          startWorkers();
          return import('@/jobs/cron');
        })
        .then(({ registerCronJobs }) => registerCronJobs())
        .catch((err: unknown) => {
          logger.error({ err }, 'Failed to start workers or register cron jobs');
        });
    }
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      logger.error({ port: env.PORT }, `Port ${env.PORT} is already in use`);
    } else {
      logger.error({ err }, 'HTTP server error');
    }
    process.exit(1);
  });
}

// ── Graceful shutdown ─────────────────────────────────────────

async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info({ signal }, 'Shutdown signal received — draining connections...');

  const shutdownTimeout = setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, env.SHUTDOWN_TIMEOUT_MS);

  try {
    // Stop accepting new connections
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }

    // Close queues and workers
    try {
      const { closeQueues } = await import('@/jobs/queues');
      const { stopWorkers } = await import('@/jobs/workers');
      await Promise.allSettled([closeQueues(), stopWorkers()]);
    } catch {
      // Workers are optional
    }

    // Disconnect DB + Redis
    await unloadDependencies();

    clearTimeout(shutdownTimeout);
    logger.info('Graceful shutdown complete');
    process.exit(0);
  } catch (err) {
    clearTimeout(shutdownTimeout);
    logger.error({ err }, 'Error during graceful shutdown');
    process.exit(1);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught errors — log and continue (do not crash for operational errors)
process.on('unhandledRejection', (reason: unknown) => {
  logger.error({ reason }, 'Unhandled Promise rejection');
  // Do not exit — allow graceful degradation
});

process.on('uncaughtException', (err: Error) => {
  logger.fatal({ err }, 'Uncaught exception — shutting down');
  gracefulShutdown('UNCAUGHT_EXCEPTION').catch(() => process.exit(1));
});

bootstrap().catch((err) => {
  logger.fatal({ err }, 'Failed to start server');
  process.exit(1);
});
