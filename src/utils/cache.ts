import { getRedisClient } from '@/config/redis';
import { logger } from '@/config/logger';
import { env } from '@/config/env';

/**
 * Cache-aside pattern helper.
 * On miss: calls loader, stores result, returns it.
 * On Redis failure: falls through to loader (graceful degradation).
 */
export async function cacheGetOrSet<T>(
  key: string,
  loader: () => Promise<T>,
  ttlSeconds: number = env.CACHE_TTL_DEFAULT,
): Promise<T> {
  const redis = getRedisClient();

  try {
    const cached = await redis.get(key);
    if (cached !== null) {
      return JSON.parse(cached) as T;
    }
  } catch (err) {
    logger.warn({ err, key }, 'Cache read failed, falling through to DB');
  }

  const data = await loader();

  try {
    // Jitter: ±10% of TTL to prevent thundering herd
    const jitter = Math.floor(ttlSeconds * 0.1 * (Math.random() * 2 - 1));
    const effectiveTtl = Math.max(1, ttlSeconds + jitter);
    await redis.setex(key, effectiveTtl, JSON.stringify(data));
  } catch (err) {
    logger.warn({ err, key }, 'Cache write failed');
  }

  return data;
}

export async function cacheDelete(key: string): Promise<void> {
  try {
    const redis = getRedisClient();
    await redis.del(key);
  } catch (err) {
    logger.warn({ err, key }, 'Cache delete failed');
  }
}

export async function cacheDeletePattern(pattern: string): Promise<void> {
  try {
    const redis = getRedisClient();
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } catch (err) {
    logger.warn({ err, pattern }, 'Cache pattern delete failed');
  }
}

export function buildCacheKey(...parts: (string | number | null | undefined)[]): string {
  return parts.filter(Boolean).join(':');
}
