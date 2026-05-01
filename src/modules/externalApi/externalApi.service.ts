/**
 * External API Service — orchestrates syncing a payment/enrollment record
 * to the downstream external system.
 *
 * Retry strategy:
 *   - Up to 3 immediate attempts (1s, 2s, 4s exponential backoff) for 5xx / network errors
 *   - On 401 → refresh token, retry once
 *   - On 4xx (not 401) → terminal failure; mark FAILED, push to DLQ via queue
 *   - On exhausted retries → mark FAILED with retryCount for cron to pick up
 *     (cron retries up to env.API_RETRY_LIMIT, then marks DEAD_LETTER)
 */

import { prisma } from '@/config/database';
import { logger } from '@/config/logger';
import { env } from '@/config/env';
import { externalApiRepository } from './externalApi.repository';
import {
  postUser,
  refreshToken,
  ExternalApiNetworkError,
  ExternalApiHttpError,
} from './externalApi.client';

const IMMEDIATE_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 1000;

function backoffMs(attempt: number): number {
  return BACKOFF_BASE_MS * Math.pow(2, attempt);
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Compute next retry timestamp for the cron-based retry.
 * Uses exponential backoff: attempt 1 → 2 min, 2 → 4 min, etc.
 */
function nextRetryAt(retryCount: number): Date {
  const delayMs = Math.min(2 * 60 * 1000 * Math.pow(2, retryCount), 60 * 60 * 1000); // cap 1h
  return new Date(Date.now() + delayMs);
}

/**
 * Build the payload to send to the external API from a paymentId.
 */
async function buildPayload(paymentId: string): Promise<Record<string, unknown> | null> {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: {
      id: true,
      razorpayOrderId: true,
      razorpayPaymentId: true,
      status: true,
      finalAmount: true,
      paidAmount: true,
      currency: true,
      enrollmentId: true,
      enrollment: {
        select: {
          enrollmentId: true,
          name: true,
          email: true,
          phone: true,
          role: true,
          source: true,
          education: true,
        },
      },
    },
  });

  if (!payment) return null;

  return {
    paymentId: payment.id,
    razorpayOrderId: payment.razorpayOrderId,
    razorpayPaymentId: payment.razorpayPaymentId,
    paymentStatus: payment.status,
    amount: payment.paidAmount,
    currency: payment.currency,
    enrollmentId: payment.enrollment.enrollmentId,
    studentName: payment.enrollment.name,
    studentEmail: payment.enrollment.email,
    studentPhone: payment.enrollment.phone,
    role: payment.enrollment.role,
    source: payment.enrollment.source,
    education: payment.enrollment.education,
  };
}

/**
 * Attempt the external API call with immediate retries (up to IMMEDIATE_ATTEMPTS).
 * Returns null if all attempts exhausted.
 */
async function attemptWithRetry(
  payload: Record<string, unknown>,
  logId: string,
): Promise<{ status: number; body: unknown; duration: number } | null> {
  let tokenRefreshed = false;

  for (let attempt = 0; attempt < IMMEDIATE_ATTEMPTS; attempt++) {
    const startedAt = new Date();

    try {
      const result = await postUser(payload);

      await externalApiRepository.update(logId, {
        responseStatus: result.status,
        responseBody: result.body as Record<string, unknown>,
        lastAttemptAt: startedAt,
        duration: result.duration,
      });

      // 2xx = success
      if (result.status >= 200 && result.status < 300) {
        return result;
      }

      // 401 → refresh and retry once
      if (result.status === 401 && !tokenRefreshed) {
        tokenRefreshed = true;
        try {
          await refreshToken();
          // don't sleep — retry immediately after token refresh
          continue;
        } catch (refreshErr) {
          logger.error({ err: refreshErr, logId }, 'Token refresh failed');
          await externalApiRepository.update(logId, {
            syncStatus: 'FAILED',
            error: `Token refresh failed: ${String(refreshErr)}`,
            lastAttemptAt: startedAt,
          });
          return null;
        }
      }

      // 4xx (not 401) → terminal failure, no retry
      if (result.status >= 400 && result.status < 500) {
        logger.warn(
          { logId, status: result.status, body: result.body },
          'External API 4xx — terminal failure',
        );
        await externalApiRepository.update(logId, {
          syncStatus: 'FAILED',
          error: `HTTP ${result.status} — terminal 4xx error`,
          lastAttemptAt: startedAt,
          retryCount: env.API_RETRY_LIMIT, // force DLQ on next cron run
        });
        return null;
      }

      // 5xx → retryable, fall through to backoff
      logger.warn({ logId, status: result.status, attempt }, 'External API 5xx — will retry');

      if (attempt < IMMEDIATE_ATTEMPTS - 1) {
        await sleep(backoffMs(attempt));
      }
    } catch (err) {
      if (err instanceof ExternalApiNetworkError) {
        logger.warn({ err, logId, attempt }, 'External API network error — will retry');
        await externalApiRepository.update(logId, {
          error: err.message,
          lastAttemptAt: startedAt,
        });
        if (attempt < IMMEDIATE_ATTEMPTS - 1) {
          await sleep(backoffMs(attempt));
        }
      } else {
        throw err; // unexpected — rethrow
      }
    }
  }

  return null; // exhausted immediate attempts
}

/**
 * Primary sync entry point — called from webhook handler.
 */
export async function syncUserAfterPayment(paymentId: string): Promise<void> {
  const correlationId = `ext:${paymentId}:${Date.now()}`;

  logger.info({ paymentId, correlationId }, 'Starting external API sync');

  const payload = await buildPayload(paymentId);
  if (!payload) {
    logger.warn({ paymentId }, 'Payment not found — skipping external API sync');
    return;
  }

  // Create audit log row
  const log = await externalApiRepository.create({
    paymentId,
    enrollmentId: payload['enrollmentId'] as string | null,
    endpoint: `${env.EXTERNAL_API_URL}/users`,
    method: 'POST',
    requestBody: payload as Record<string, unknown>,
  });

  const result = await attemptWithRetry(payload, log.id);

  if (result) {
    await externalApiRepository.update(log.id, {
      syncStatus: 'SUCCESS',
      responseStatus: result.status,
      responseBody: result.body as Record<string, unknown>,
    });
    logger.info({ paymentId, logId: log.id, correlationId }, 'External API sync succeeded');
  } else {
    // Mark failed — set nextRetryAt for cron pickup (if retryCount < API_RETRY_LIMIT)
    const updatedLog = await externalApiRepository.findById(log.id);
    const currentRetry = updatedLog?.retryCount ?? 0;

    if (currentRetry < env.API_RETRY_LIMIT) {
      await externalApiRepository.update(log.id, {
        syncStatus: 'FAILED',
        retryCount: currentRetry + IMMEDIATE_ATTEMPTS,
        nextRetryAt: nextRetryAt(currentRetry),
      });
      logger.warn(
        { paymentId, logId: log.id, correlationId },
        'External API sync failed — queued for cron retry',
      );
    } else {
      await externalApiRepository.update(log.id, {
        syncStatus: 'DEAD_LETTER',
      });
      logger.error(
        { paymentId, logId: log.id, correlationId },
        'External API sync permanently failed — moved to dead letter',
      );
    }
  }
}

/**
 * Retry a single ExternalApiLog row (called by cron).
 * Returns true if succeeded.
 */
export async function retryExternalApiLog(logId: string): Promise<boolean> {
  const log = await externalApiRepository.findById(logId);
  if (!log) return false;

  const payload = (log.requestBody ?? {}) as Record<string, unknown>;
  const result = await attemptWithRetry(payload, logId);

  if (result) {
    await externalApiRepository.update(logId, { syncStatus: 'SUCCESS' });
    return true;
  }

  const fresh = await externalApiRepository.findById(logId);
  const currentRetry = fresh?.retryCount ?? log.retryCount;

  if (currentRetry >= env.API_RETRY_LIMIT) {
    await externalApiRepository.markDeadLetter(logId);
  } else {
    await externalApiRepository.update(logId, {
      retryCount: currentRetry + 1,
      nextRetryAt: nextRetryAt(currentRetry),
    });
  }

  return false;
}
