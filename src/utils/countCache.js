'use strict';

/**
 * In-memory TTL cache for expensive COUNT(*) queries behind paginated lists.
 *
 * Problem this solves:
 *   On tables with millions of rows, `SELECT count(*) FROM t WHERE …` is
 *   slow (seq-scan or partial-index scan). Paginated list endpoints call
 *   COUNT on every page navigation just to compute `totalPages`, even
 *   though the value barely changes second-to-second on an admin table.
 *
 * Design:
 *   - Key  = caller-supplied namespace + JSON-stable hash of the filter
 *            object. Different filter combos cache independently.
 *   - TTL  = configurable per call; default 60s. Tradeoff: fresher = more
 *            DB load; staler = cheaper. 60s is the SaaS-admin sweet spot.
 *   - Single-flight: in-flight COUNT queries for the same key share a
 *            single Promise so a thundering herd on page-1 first-load
 *            collapses to one DB round-trip.
 *   - LRU eviction at MAX_KEYS to bound memory in case the call site
 *            generates an unbounded key space (e.g. free-text search).
 *
 * Per-instance: in a horizontally-scaled deployment each backend pod has
 * its own cache. That is intentional — counts are not consensus-critical
 * and a 60-second drift across pods is acceptable for an admin UI.
 *
 * Not used for: total counts that drive billing, quotas, or rate limits.
 * Those must always hit the database directly.
 */

const MAX_KEYS         = 1024;
const DEFAULT_TTL_MS   = 60_000;

// store: Map<key, { value: number, expiresAt: number }>
const store     = new Map();
// in-flight: Map<key, Promise<number>>
const inflight  = new Map();

function stableStringify(obj) {
  if (obj == null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(stableStringify).join(',') + ']';
  const keys = Object.keys(obj).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}';
}

function bumpLru(key, entry) {
  // Map preserves insertion order; re-set to mark as most-recently-used.
  store.delete(key);
  store.set(key, entry);
}

function evictIfNeeded() {
  while (store.size > MAX_KEYS) {
    const oldestKey = store.keys().next().value;
    store.delete(oldestKey);
  }
}

/**
 * Get a count for the given (namespace, filter), using a cached value if
 * fresh or invoking `loader()` to fetch + cache otherwise.
 *
 * @param {string} namespace                 - e.g. 'admin.enrollments'
 * @param {object} filter                    - JSON-serialisable filter object
 * @param {() => Promise<number>} loader     - performs the actual COUNT
 * @param {{ ttlMs?: number }} [opts]
 * @returns {Promise<number>}
 */
async function getCount(namespace, filter, loader, opts = {}) {
  const ttlMs = Number.isFinite(opts.ttlMs) && opts.ttlMs > 0 ? opts.ttlMs : DEFAULT_TTL_MS;
  const key   = namespace + '::' + stableStringify(filter || {});
  const now   = Date.now();

  const cached = store.get(key);
  if (cached && cached.expiresAt > now) {
    bumpLru(key, cached);
    return cached.value;
  }

  // Coalesce concurrent misses for the same key — only one DB query fires.
  const pending = inflight.get(key);
  if (pending) return pending;

  const promise = (async () => {
    try {
      const value = await loader();
      store.set(key, { value, expiresAt: Date.now() + ttlMs });
      evictIfNeeded();
      return value;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, promise);
  return promise;
}

/**
 * Invalidate cached counts for a given namespace. Call after a write that
 * may change the total (e.g. createEnrollment, soft-delete, bulk import).
 * Without an explicit invalidation the cache simply ages out via TTL.
 *
 * If `predicate` is provided it receives the filter portion of each cache
 * key as a parsed object and is called for each entry — return true to
 * drop that entry.
 *
 * @param {string} namespace
 * @param {((filter: object) => boolean)} [predicate]
 */
function invalidate(namespace, predicate) {
  const prefix = namespace + '::';
  for (const key of store.keys()) {
    if (!key.startsWith(prefix)) continue;
    if (!predicate) {
      store.delete(key);
      continue;
    }
    let parsed = null;
    try { parsed = JSON.parse(key.slice(prefix.length)); } catch { /* ignore */ }
    if (predicate(parsed)) store.delete(key);
  }
}

/** Test/diagnostic helper. */
function _stats() {
  return { size: store.size, inflight: inflight.size, maxKeys: MAX_KEYS };
}

function _clear() {
  store.clear();
  inflight.clear();
}

module.exports = { getCount, invalidate, _stats, _clear };
