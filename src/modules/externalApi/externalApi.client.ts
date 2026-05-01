/**
 * External API HTTP client.
 *
 * Uses the global fetch API (Node 20+) with AbortController for timeouts.
 * Reads credentials and base URL from env — never hardcoded.
 *
 * Public interface:
 *   postUser(payload) — sync a user record downstream
 *   refreshToken()    — re-exchange credentials for a new access token
 */

import { env } from '@/config/env';
import { logger } from '@/config/logger';

export interface ExternalApiResponse {
  status: number;
  body: unknown;
  duration: number;
}

export class ExternalApiNetworkError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ExternalApiNetworkError';
  }
}

export class ExternalApiHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
    public readonly duration: number,
  ) {
    super(`External API returned HTTP ${status}`);
    this.name = 'ExternalApiHttpError';
  }
}

let _bearerToken: string = env.EXTERNAL_API_TOKEN;

/**
 * Override the bearer token (used after a token refresh).
 */
export function setBearerToken(token: string): void {
  _bearerToken = token;
}

/**
 * Core fetch wrapper with AbortController timeout.
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number,
): Promise<ExternalApiResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    const duration = Date.now() - start;
    let body: unknown;
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      body = await response.json();
    } else {
      body = await response.text();
    }
    return { status: response.status, body, duration };
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new ExternalApiNetworkError(
        `External API request timed out after ${timeoutMs}ms`,
        err,
      );
    }
    throw new ExternalApiNetworkError(`External API network error: ${String(err)}`, err);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * POST /users — sync a user/enrollment record to the external system.
 */
export async function postUser(
  payload: Record<string, unknown>,
): Promise<ExternalApiResponse> {
  if (!env.EXTERNAL_API_URL) {
    logger.warn('EXTERNAL_API_URL not configured — skipping external API call');
    return { status: 200, body: { skipped: true }, duration: 0 };
  }

  const url = `${env.EXTERNAL_API_URL}/users`;

  logger.debug({ url }, 'Calling external API postUser');

  return fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${_bearerToken}`,
        'X-Source': 'kommon-school',
      },
      body: JSON.stringify(payload),
    },
    env.EXTERNAL_API_TIMEOUT_MS,
  );
}

/**
 * POST /auth/refresh — exchange credentials for a new access token.
 * Returns the new token string on success, throws on failure.
 */
export async function refreshToken(): Promise<string> {
  if (!env.EXTERNAL_API_URL) {
    throw new ExternalApiNetworkError('EXTERNAL_API_URL not configured');
  }

  const url = `${env.EXTERNAL_API_URL}/auth/refresh`;

  const result = await fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${_bearerToken}`,
      },
      body: JSON.stringify({ token: _bearerToken }),
    },
    env.EXTERNAL_API_TIMEOUT_MS,
  );

  if (result.status !== 200) {
    throw new ExternalApiHttpError(result.status, result.body, result.duration);
  }

  const body = result.body as Record<string, unknown>;
  const newToken = (body['token'] ?? body['access_token']) as string | undefined;
  if (!newToken) {
    throw new ExternalApiNetworkError('refreshToken response missing token field');
  }

  setBearerToken(newToken);
  return newToken;
}
