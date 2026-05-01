/**
 * Distributed lock via Redis SET NX PX.
 *
 * Usage:
 *   const lock = await acquireLock('lock:webhook:evt_123', 10_000);
 *   if (!lock) return; // another instance is handling it
 *   try { ... } finally { await releaseLock(lock); }
 */

import { getRedisClient } from '@/config/redis';
import { logger } from '@/config/logger';
import { v4 as uuidv4 } from 'uuid';

export interface Lock {
  key: string;
  token: string;
}

/**
 * Acquire a Redis-backed distributed lock.
 *
 * @param key    - Lock key (e.g. "lock:webhook:evt_123")
 * @param ttlMs  - Lock TTL in milliseconds (auto-release if process dies)
 * @returns      Lock handle on success, null if lock is held by another instance
 */
export async function acquireLock(key: string, ttlMs: number): Promise<Lock | null> {
  const redis = getRedisClient();
  const token = uuidv4();

  try {
    // SET key token NX PX ttl — atomic; returns 'OK' on success, null on failure
    const result = await redis.set(key, token, 'PX', ttlMs, 'NX');
    if (result === 'OK') {
      return { key, token };
    }
    return null;
  } catch (err) {
    logger.warn({ err, key }, 'Failed to acquire distributed lock — proceeding without lock');
    // On Redis failure, return null (caller decides how to proceed)
    return null;
  }
}

/**
 * Release a lock. Only releases if the token matches (prevents releasing another owner's lock).
 */
export async function releaseLock(lock: Lock): Promise<void> {
  const redis = getRedisClient();

  // Atomic check-and-delete using Lua script
  const script = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("del", KEYS[1])
    else
      return 0
    end
  `;

  try {
    await redis.eval(script, 1, lock.key, lock.token);
  } catch (err) {
    logger.warn({ err, key: lock.key }, 'Failed to release distributed lock');
  }
}

/**
 * Run a function under a distributed lock.
 * If the lock cannot be acquired, returns null without executing fn.
 *
 * @param key   - Lock key
 * @param ttlMs - Lock TTL
 * @param fn    - Async function to run under the lock
 */
export async function withLock<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<T | null> {
  const lock = await acquireLock(key, ttlMs);
  if (!lock) {
    logger.debug({ key }, 'Lock not acquired — skipping (another instance is handling this)');
    return null;
  }

  try {
    return await fn();
  } finally {
    await releaseLock(lock);
  }
}
