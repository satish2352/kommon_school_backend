'use strict';

/**
 * Parse a Retry-After header value (seconds or HTTP-date) and return
 * the equivalent number of milliseconds, or undefined if unparseable.
 *
 * @param {Error} err  — axios error with optional response
 * @returns {number|undefined}
 */
function parseRetryAfter(err) {
  const header = err.response && err.response.headers && err.response.headers['retry-after'];
  if (!header) return undefined;

  const seconds = Number(header);
  if (!Number.isNaN(seconds) && seconds > 0) {
    return Math.ceil(seconds) * 1000;
  }

  // HTTP-date format: "Wed, 21 Oct 2025 07:28:00 GMT"
  const date = new Date(header);
  if (!Number.isNaN(date.getTime())) {
    const diff = date.getTime() - Date.now();
    return diff > 0 ? diff : undefined;
  }

  return undefined;
}

/**
 * Classify an error thrown by the external API call and decide whether
 * BullMQ should retry the job or terminate it.
 *
 * Return shape:
 * ```
 * {
 *   retry: boolean,
 *   terminal: boolean,
 *   reason: string,
 *   retryAfterMs?: number,   // present on 429 only
 * }
 * ```
 *
 * `terminal: true` means markFailed (no BullMQ retry).
 * `terminal: false, retry: true` means rethrow so BullMQ retries.
 * `terminal: false, retry: false, reason: 'ALREADY_SYNCED'` → treat as success.
 *
 * @param {Error} err
 * @returns {{ retry: boolean, terminal: boolean, reason: string, retryAfterMs?: number }}
 */
function classify(err) {
  // Circuit-breaker open
  if (err.code === 'EOPENBREAKER' || (err.message && err.message.includes('EOPENBREAKER'))) {
    return { retry: true, terminal: false, reason: 'BREAKER_OPEN' };
  }

  const statusCode = err.response && err.response.status;

  if (!statusCode) {
    // Network error, DNS failure, ECONNREFUSED, timeout (ECONNABORTED/ETIMEDOUT)
    return { retry: true, terminal: false, reason: 'TRANSIENT' };
  }

  if (statusCode === 400 || statusCode === 422) {
    return { retry: false, terminal: true, reason: 'CLIENT_ERROR' };
  }

  if (statusCode === 401) {
    return { retry: true, terminal: false, reason: 'UNAUTHORIZED' };
  }

  if (statusCode === 409) {
    // Remote already processed this enrollment — treat as success
    return { retry: false, terminal: false, reason: 'ALREADY_SYNCED' };
  }

  if (statusCode === 429) {
    return {
      retry: true,
      terminal: false,
      reason: 'RATE_LIMITED',
      retryAfterMs: parseRetryAfter(err),
    };
  }

  if (statusCode >= 500) {
    return { retry: true, terminal: false, reason: 'TRANSIENT' };
  }

  return { retry: true, terminal: false, reason: 'UNKNOWN' };
}

module.exports = { classify, parseRetryAfter };
