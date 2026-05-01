import { Request, Response } from 'express';
import { prisma } from '@/config/database';
import { pingRedis } from '@/config/redis';
import { asyncHandler } from '@/utils/asyncHandler';
import { env } from '@/config/env';
import os from 'os';

/**
 * @openapi
 * /health:
 *   get:
 *     tags: [Health]
 *     summary: Liveness probe
 *     description: Returns 200 if the process is alive. No DB or Redis checks.
 *     security: []
 *     responses:
 *       200:
 *         description: Service is alive
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: ok
 *                 timestamp:
 *                   type: string
 *                 uptime:
 *                   type: number
 *                 version:
 *                   type: string
 */
export const liveness = asyncHandler(async (_req: Request, res: Response): Promise<void> => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: process.env['npm_package_version'] ?? '1.0.0',
    nodeVersion: process.version,
    env: env.NODE_ENV,
  });
});

/**
 * @openapi
 * /health/ready:
 *   get:
 *     tags: [Health]
 *     summary: Readiness probe
 *     description: Checks DB + Redis connectivity. Returns 503 if either is unavailable.
 *     security: []
 *     responses:
 *       200:
 *         description: All dependencies healthy
 *       503:
 *         description: One or more dependencies unavailable
 */
export const readiness = asyncHandler(async (_req: Request, res: Response): Promise<void> => {
  const checks = await Promise.allSettled([
    checkDatabase(),
    checkRedis(),
  ]);

  const dbCheck = checks[0];
  const redisCheck = checks[1];

  const dbStatus = dbCheck?.status === 'fulfilled' ? dbCheck.value : { status: 'error', latency: -1, error: String((dbCheck as PromiseRejectedResult).reason) };
  const redisStatus = redisCheck?.status === 'fulfilled' ? redisCheck.value : { status: 'error', latency: -1, error: String((redisCheck as PromiseRejectedResult).reason) };

  const allHealthy = dbStatus.status === 'ok' && redisStatus.status === 'ok';
  const statusCode = allHealthy ? 200 : 503;

  res.status(statusCode).json({
    status: allHealthy ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    checks: {
      database: dbStatus,
      redis: redisStatus,
    },
  });
});

/**
 * @openapi
 * /health/metrics:
 *   get:
 *     tags: [Health]
 *     summary: Basic runtime metrics
 *     description: Returns memory, CPU, and process metrics.
 *     security: []
 *     responses:
 *       200:
 *         description: Metrics snapshot
 */
export const metrics = asyncHandler(async (_req: Request, res: Response): Promise<void> => {
  const mem = process.memoryUsage();
  const cpuUsage = process.cpuUsage();

  res.status(200).json({
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    process: {
      pid: process.pid,
      nodeVersion: process.version,
      platform: process.platform,
    },
    memory: {
      rss: formatBytes(mem.rss),
      heapTotal: formatBytes(mem.heapTotal),
      heapUsed: formatBytes(mem.heapUsed),
      external: formatBytes(mem.external),
      heapUsedPercent: ((mem.heapUsed / mem.heapTotal) * 100).toFixed(2) + '%',
    },
    cpu: {
      user: cpuUsage.user,
      system: cpuUsage.system,
    },
    system: {
      loadAvg: os.loadavg(),
      totalMemory: formatBytes(os.totalmem()),
      freeMemory: formatBytes(os.freemem()),
      cpuCount: os.cpus().length,
    },
  });
});

// ── Private helpers ────────────────────────────────────────

async function checkDatabase(): Promise<{ status: string; latency: number; error?: string }> {
  const start = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { status: 'ok', latency: Date.now() - start };
  } catch (err) {
    return { status: 'error', latency: Date.now() - start, error: 'Database unreachable' };
  }
}

async function checkRedis(): Promise<{ status: string; latency: number; error?: string }> {
  const start = Date.now();
  try {
    const ok = await pingRedis();
    if (ok) return { status: 'ok', latency: Date.now() - start };
    return { status: 'error', latency: Date.now() - start, error: 'Redis ping failed' };
  } catch (err) {
    return { status: 'error', latency: Date.now() - start, error: 'Redis unreachable' };
  }
}

function formatBytes(bytes: number): string {
  const mb = bytes / 1024 / 1024;
  return `${mb.toFixed(2)} MB`;
}
