import { connectDatabase, disconnectDatabase } from '@/config/database';
import { connectRedis, disconnectRedis } from '@/config/redis';
import { logger } from '@/config/logger';

export async function loadDependencies(): Promise<void> {
  // Connect to DB — server starts even if DB is unavailable (graceful degradation)
  try {
    await connectDatabase();
  } catch (err) {
    logger.error({ err }, 'Database connection failed on startup — retrying on first request');
  }

  // Connect to Redis — non-fatal
  try {
    await connectRedis();
  } catch (err) {
    logger.error({ err }, 'Redis connection failed on startup — caching and rate limiting degraded');
  }
}

export async function unloadDependencies(): Promise<void> {
  await Promise.allSettled([disconnectDatabase(), disconnectRedis()]);
}
