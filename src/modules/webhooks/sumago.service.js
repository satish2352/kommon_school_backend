'use strict';

/**
 * sumago.service.js
 *
 * Server-side proxy for the Sumago Platform Integration API.
 * Holds the Bearer token in process env — never exposes it to the browser.
 *
 * Env vars (validated in config/env.js):
 *   SUMAGO_API_BASE_URL — e.g. https://beta.kommonschool.com/v1/api
 *   SUMAGO_API_TOKEN    — org-specific bearer token
 *
 * Per documentation:
 *   GET <base>/integrations/get-users
 *     200 → { status, organizationCode, totalUsers, users: [...] }
 *     401 → invalid/missing token
 *     404 → no users for this org
 *     500 → upstream error
 */

const logger = require('../../config/logger');
const ApiError = require('../../utils/ApiError');

const SUMAGO_REQUEST_TIMEOUT_MS =
  parseInt(process.env.SUMAGO_REQUEST_TIMEOUT_MS, 10) || 15000;

function getConfig() {
  const base  = (process.env.SUMAGO_API_BASE_URL || '').replace(/\/$/, '');
  const token =  process.env.SUMAGO_API_TOKEN || '';
  return { base, token, enabled: Boolean(base && token) };
}

/**
 * GET <base>/integrations/get-users
 * Returns the parsed JSON body on 2xx; throws ApiError on non-2xx.
 *
 * @param {string} traceId — for log correlation
 * @returns {Promise<object>}
 */
async function fetchUsers(traceId) {
  const { base, token, enabled } = getConfig();

  if (!enabled) {
    throw new ApiError(
      503,
      'SUMAGO_NOT_CONFIGURED',
      'Sumago integration is not configured. Set SUMAGO_API_BASE_URL and SUMAGO_API_TOKEN in the backend env.',
    );
  }

  const url = `${base}/integrations/get-users`;
  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), SUMAGO_REQUEST_TIMEOUT_MS);

  logger.info({ msg: 'sumago_fetch_users_start', traceId, url });

  let response;
  let bodyText = null;
  let parsedBody = null;
  const startMs = Date.now();

  try {
    response = await fetch(url, {
      method:  'GET',
      headers: {
        Accept:        'application/json',
        Authorization: `Bearer ${token}`,
      },
      signal: controller.signal,
    });

    try {
      bodyText = await response.text();
      if (bodyText) {
        try { parsedBody = JSON.parse(bodyText); } catch { parsedBody = null; }
      }
    } catch {
      bodyText = null;
    }
  } catch (fetchErr) {
    clearTimeout(timeoutId);
    const isTimeout = fetchErr?.name === 'AbortError';
    logger.error({
      msg:      'sumago_fetch_users_error',
      traceId,
      error:    isTimeout ? 'TIMEOUT' : fetchErr?.message ?? String(fetchErr),
    });
    throw new ApiError(
      isTimeout ? 504 : 502,
      'SUMAGO_UPSTREAM_ERROR',
      isTimeout ? 'Sumago API request timed out.' : 'Failed to reach Sumago API.',
    );
  }
  clearTimeout(timeoutId);

  const durationMs = Date.now() - startMs;
  logger.info({
    msg:        'sumago_fetch_users_done',
    traceId,
    status:     response.status,
    duration_ms: durationMs,
    user_count: parsedBody?.totalUsers ?? parsedBody?.users?.length ?? null,
  });

  if (!response.ok) {
    // 401 / 404 / 500 mapped to specific frontend-facing codes.
    const statusMap = {
      401: ['SUMAGO_UNAUTHORIZED', 'Sumago bearer token is missing, invalid, or expired.'],
      404: ['SUMAGO_NOT_FOUND',    'No users found for this organization on Sumago.'],
    };
    const [code, message] = statusMap[response.status] ?? [
      'SUMAGO_UPSTREAM_ERROR',
      parsedBody?.message || `Sumago API returned ${response.status}.`,
    ];
    throw new ApiError(response.status === 401 ? 401 : 502, code, message);
  }

  return parsedBody ?? { status: 'success', users: [], totalUsers: 0 };
}

module.exports = { fetchUsers, getConfig };
