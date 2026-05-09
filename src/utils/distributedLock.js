'use strict';

/**
 * Redis-backed distributed lock using SETNX-with-TTL semantics.
 *
 * Pattern: SET key lockId PX ttlMs NX
 *   - Atomic — no gap between SET and EXPIRE.
 *   - NX ensures only one caller acquires at a time.
 *   - PX TTL auto-expires the lock if the process dies before release.
 *
 * Release uses a Lua script so the check-then-delete is atomic:
 *   only the lock holder (matched by lockId) can delete the key.
 *
 * withLock() is the primary public API. Callers that cannot acquire the lock
 * receive null immediately (they should log "job_skipped" and move on — another
 * process instance is already running the same job).
 */

const { randomUUID } = require('crypto');
const { getRedis } = require('../config/redis');
const logger = require('../config/logger');

// Lua script: delete the key only if its current value equals the supplied lockId.
// Returns 1 if deleted, 0 if the key was gone or owned by someone else.
const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

/**
 * Attempt to acquire a distributed lock.
 *
 * @param {string} key    — Redis key (should be prefixed, e.g. "lock:job:reconciliation")
 * @param {number} ttlMs  — Lock TTL in milliseconds. Set to slightly longer than the
 *                          expected job runtime so a crashed process does not hold the
 *                          lock forever but a slow job does not self-expire.
 * @returns {Promise<string|null>}  lockId (a UUID) if acquired, null otherwise.
 */
async function acquireLock(key, ttlMs) {
  const redis = getRedis();
  const lockId = randomUUID();
  // SET key lockId PX ttlMs NX — returns "OK" on success, null on contention
  const result = await redis.set(key, lockId, 'PX', ttlMs, 'NX');
  return result === 'OK' ? lockId : null;
}

/**
 * Release a distributed lock. Safe no-op if the lock was already released or
 * expired. Only releases if this caller owns the lock (lockId matches).
 *
 * @param {string} key
 * @param {string} lockId
 * @returns {Promise<boolean>}  true if released, false if not owner or already gone.
 */
async function releaseLock(key, lockId) {
  const redis = getRedis();
  try {
    const result = await redis.eval(RELEASE_SCRIPT, 1, key, lockId);
    return result === 1;
  } catch (err) {
    logger.error({ msg: 'distributed_lock_release_error', key, error: err.message });
    return false;
  }
}

/**
 * Run fn() inside a distributed lock.
 *
 * If the lock cannot be acquired (another instance holds it), returns null
 * without calling fn(). The caller should treat null as "job skipped".
 *
 * If fn() throws, the error is re-thrown after the lock is released so the
 * job registry can log job_failed correctly.
 *
 * @param {string}   key
 * @param {number}   ttlMs
 * @param {Function} fn    — async function to run under the lock
 * @returns {Promise<*|null>}  fn()'s return value, or null if lock not acquired.
 */
async function withLock(key, ttlMs, fn) {
  const lockId = await acquireLock(key, ttlMs);
  if (!lockId) {
    return null;
  }

  try {
    return await fn();
  } finally {
    await releaseLock(key, lockId);
  }
}

module.exports = { acquireLock, releaseLock, withLock };
