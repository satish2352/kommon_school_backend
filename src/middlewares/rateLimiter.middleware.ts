import rateLimit, { RateLimitRequestHandler } from 'express-rate-limit';
import { env } from '@/config/env';
import { ApiError } from '@/utils/ApiError';
import { logger } from '@/config/logger';

// Use memory store fallback — Redis store for rate-limit requires additional
// configuration that varies per redis client type. For production, wire up
// a proper RedisStore. Using in-memory store here for startup compatibility.
function makeRateLimiter(options: {
  windowMs: number;
  max: number;
  message?: string;
}): RateLimitRequestHandler {
  return rateLimit({
    windowMs: options.windowMs,
    max: options.max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      // Rate limit per IP
      return req.ip ?? req.socket.remoteAddress ?? 'unknown';
    },
    handler: (_req, _res, next) => {
      next(ApiError.tooManyRequests(options.message ?? 'Too many requests, please try again later'));
    },
    skip: (req) => {
      // Skip rate limiting for health checks
      return req.path.startsWith('/health');
    },
  });
}

/**
 * Attempts to create a Redis-backed rate limit store.
 * Falls back to in-memory if Redis is unavailable.
 */
async function tryAttachRedisStore(limiter: RateLimitRequestHandler, prefix: string): Promise<void> {
  try {
    const { getRedisClient } = await import('@/config/redis');
    const RedisStore = (await import('rate-limit-redis')).default;
    const client = getRedisClient();

    // Test if client is ready
    const isReady = client.status === 'ready';
    if (!isReady) {
      logger.warn({ prefix }, 'Redis not ready — rate limiter using in-memory store');
      return;
    }

    const store = new RedisStore({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sendCommand: ((...args: string[]) => (client as any).call(...args)) as any,
      prefix: `rl:${prefix}:`,
    });

    // Patch the limiter's store (express-rate-limit exposes store as writable)
    (limiter as unknown as { store: typeof store }).store = store;
    logger.debug({ prefix }, 'Redis rate limit store attached');
  } catch (err) {
    logger.warn({ err, prefix }, 'Redis rate limit store unavailable — using in-memory fallback');
  }
}

/**
 * Global rate limiter — applied to all routes
 */
export const globalRateLimiter = makeRateLimiter({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX_REQUESTS,
  message: 'Too many requests from this IP, please try again later',
});

/**
 * Auth rate limiter — login, register, forgot-password
 */
export const authRateLimiter = makeRateLimiter({
  windowMs: env.AUTH_RATE_LIMIT_WINDOW_MS,
  max: env.AUTH_RATE_LIMIT_MAX_REQUESTS,
  message: 'Too many authentication attempts, please try again later',
});

/**
 * Sensitive rate limiter — OTP, password reset
 */
export const sensitiveRateLimiter = makeRateLimiter({
  windowMs: env.SENSITIVE_RATE_LIMIT_WINDOW_MS,
  max: env.SENSITIVE_RATE_LIMIT_MAX_REQUESTS,
  message: 'Too many attempts, please try again in an hour',
});

// Wire up Redis stores asynchronously — fails gracefully
void tryAttachRedisStore(globalRateLimiter, 'global');
void tryAttachRedisStore(authRateLimiter, 'auth');
void tryAttachRedisStore(sensitiveRateLimiter, 'sensitive');
