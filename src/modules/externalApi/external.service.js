'use strict';

const axios = require('axios');
const CircuitBreaker = require('opossum');
const repo = require('./external.repository');
const { classify } = require('./external.retry.handler');
const enrollmentRepo = require('../enrollments/enrollment.repository');
const { getPrismaClient } = require('../../config/database');
const logger = require('../../config/logger');
const { EXTERNAL_API_DEFAULTS, DEFAULT_PHONE_COUNTRY_CODE } = require('../../config/constants');

const EXTERNAL_API_URL = process.env.EXTERNAL_API_URL;
const EXTERNAL_API_TOKEN = process.env.EXTERNAL_API_TOKEN;
const EXTERNAL_API_TIMEOUT_MS = Number(process.env.EXTERNAL_API_TIMEOUT_MS) || 15000;

/**
 * Mask an email address for safe logging: j***@example.com
 *
 * @param {string} email
 * @returns {string}
 */
function maskEmail(email) {
  if (!email || typeof email !== 'string') return '***';
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  return `${local.charAt(0)}***@${domain}`;
}

/**
 * Mask a phone number — keep last 4 digits.
 *
 * @param {string} phone
 * @returns {string}
 */
function maskPhone(phone) {
  if (!phone || typeof phone !== 'string') return '***';
  return `***${phone.slice(-4)}`;
}

/**
 * The raw HTTP call wrapped by the circuit breaker.
 * Separated so opossum can track individual failures.
 *
 * @param {{ endpoint: string, body: object, enrollmentId: string }} opts
 * @returns {Promise<import('axios').AxiosResponse>}
 */
async function callExternalApi({ endpoint, body, enrollmentId }) {
  return axios.post(endpoint, body, {
    timeout: EXTERNAL_API_TIMEOUT_MS,
    headers: {
      'Authorization': `Bearer ${EXTERNAL_API_TOKEN}`,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': enrollmentId,
    },
    validateStatus: null, // handle all HTTP status codes ourselves
  });
}

// Circuit breaker wrapping the raw HTTP call.
// errorThresholdPercentage=50: open after 50% of calls fail in the rolling window.
// resetTimeout=30000: try half-open after 30 s.
const breaker = new CircuitBreaker(callExternalApi, {
  timeout: EXTERNAL_API_TIMEOUT_MS + 1000, // slightly above axios timeout
  errorThresholdPercentage: 50,
  resetTimeout: 30000,
  name: 'external-api-breaker',
  // opossum treats any resolved response with status >= 400 as success at the
  // breaker level — we evaluate status ourselves and throw inside the action
  // function when needed so the breaker correctly counts failures.
});

breaker.on('open', () => logger.warn({ msg: 'external_api_breaker_open' }));
breaker.on('halfOpen', () => logger.info({ msg: 'external_api_breaker_half_open' }));
breaker.on('close', () => logger.info({ msg: 'external_api_breaker_closed' }));

/**
 * Map enrollment + payment fields to the external API body shape.
 *
 * @param {object} enrollment  — Prisma Enrollment row
 * @param {object|null} payment — Prisma Payment row (latest success)
 * @returns {object}
 */
function normalisePhone(raw) {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (trimmed.startsWith('+')) return trimmed;
  // 10 digits → prepend default country code
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 10) return `${DEFAULT_PHONE_COUNTRY_CODE}${digits}`;
  return trimmed;
}

function deriveFirstLast(enrollment) {
  if (enrollment.first_name || enrollment.last_name) {
    return { first: enrollment.first_name || '', last: enrollment.last_name || '' };
  }
  // Fall back to splitting `name` on the LAST space (matches enrollment.service)
  const name = (enrollment.name || '').trim();
  if (!name) return { first: '', last: '' };
  const idx = name.lastIndexOf(' ');
  if (idx === -1) return { first: name, last: '' };
  return { first: name.slice(0, idx), last: name.slice(idx + 1) };
}

/**
 * Build the external-API request body. Every key is guaranteed to be non-null:
 *  - actual saved enrollment / payment data is used wherever it exists
 *  - missing fields fall back to deterministic dummy values from EXTERNAL_API_DEFAULTS
 *  - never reshape the keys — the receiving system contracts on this shape
 */
function buildRequestBody(enrollment, payment) {
  const { first, last } = deriveFirstLast(enrollment);
  const txnFromPayment = payment && payment.razorpay_payment_id;

  return {
    firstName:     first                                    || EXTERNAL_API_DEFAULTS.firstName,
    lastName:      last                                     || EXTERNAL_API_DEFAULTS.lastName,
    email:         enrollment.email                         || EXTERNAL_API_DEFAULTS.email,
    phoneNumber:   normalisePhone(enrollment.phone_number)  || EXTERNAL_API_DEFAULTS.phoneNumber,
    plan:          enrollment.plan                          || EXTERNAL_API_DEFAULTS.plan,
    group:         enrollment.group                         || EXTERNAL_API_DEFAULTS.group,
    unit:          enrollment.unit                          || EXTERNAL_API_DEFAULTS.unit,
    phase:         enrollment.phase                         || EXTERNAL_API_DEFAULTS.phase,
    segment:       enrollment.segment                       || EXTERNAL_API_DEFAULTS.segment,
    transactionId: txnFromPayment                           || `${EXTERNAL_API_DEFAULTS.transactionId}_${enrollment.id.slice(0, 8)}`,
    amount:        (enrollment.amount != null ? enrollment.amount : EXTERNAL_API_DEFAULTS.amount),
  };
}

/**
 * Fire-and-forget direct sync used when BullMQ/Redis is unavailable.
 * Loads the enrollment + payment, calls syncEnrollment, swallows any error
 * (already logged inside syncEnrollment) so the caller never blocks the user.
 *
 * @param {{ enrollmentId: string, paymentId?: string, traceId?: string }} opts
 */
async function syncEnrollmentInBackground({ enrollmentId, paymentId, traceId }) {
  try {
    const db = getPrismaClient();
    const enrollment = await db.enrollment.findFirst({
      where: { id: enrollmentId, deleted_at: null },
    });
    if (!enrollment) {
      logger.warn({ msg: 'external_api_inline_skip_no_enrollment', traceId, enrollment_id: enrollmentId });
      return;
    }
    let payment = null;
    if (paymentId) {
      payment = await db.payment.findFirst({ where: { id: paymentId } });
    }
    if (!payment) {
      payment = await db.payment.findFirst({
        where: { enrollment_id: enrollmentId, status: 'success' },
        orderBy: { created_at: 'desc' },
      });
    }
    await syncEnrollment({ enrollment, payment, traceId });
  } catch (err) {
    logger.error({
      msg: 'external_api_inline_failed',
      traceId,
      enrollment_id: enrollmentId,
      error: err && err.message,
    });
  }
}

/**
 * Sync a single enrollment to the external API.
 *
 * Idempotent: if a non-terminal ExternalApiLog already exists for this
 * enrollment, it is reused rather than creating a duplicate row.
 *
 * @param {{ enrollment: object, payment: object|null, traceId: string }} opts
 * @throws Re-throws when BullMQ should retry (non-terminal errors).
 */
async function syncEnrollment({ enrollment, payment, traceId }) {
  const endpoint = EXTERNAL_API_URL;
  const requestBody = buildRequestBody(enrollment, payment);

  // Find or create the log row (idempotent)
  let log = await repo.findActiveLogForEnrollment(enrollment.id);
  if (!log) {
    log = await repo.createLog({
      enrollment_id: enrollment.id,
      payment_id: payment ? payment.id : null,
      endpoint,
      request_body: requestBody,
    });
  }

  // Transition to processing; increment attempt counter
  await repo.updateLog(log.id, {
    status: 'processing',
    attempts: { increment: 1 },
  });

  logger.info({
    msg: 'external_api_sync_start',
    traceId,
    enrollment_id: enrollment.id,
    log_id: log.id,
    endpoint,
    email: maskEmail(enrollment.email),
    phone: maskPhone(enrollment.phone_number),
  });

  const startMs = Date.now();
  let response = null;
  let durationMs = 0;

  try {
    response = await breaker.fire({ endpoint, body: requestBody, enrollmentId: enrollment.id });
    durationMs = Date.now() - startMs;
  } catch (err) {
    durationMs = Date.now() - startMs;

    const classification = classify(err);

    logger.warn({
      msg: 'external_api_call_error',
      traceId,
      enrollment_id: enrollment.id,
      log_id: log.id,
      reason: classification.reason,
      terminal: classification.terminal,
      error: err.message,
    });

    if (classification.terminal) {
      await repo.markFailed(log.id, null, null, durationMs, err.message);
      return; // do not rethrow; BullMQ will not retry
    }

    if (classification.reason === 'ALREADY_SYNCED') {
      // 409 from remote means enrollment is already in the system — treat as success
      await repo.markSuccess(log.id, null, 409, durationMs);
      await enrollmentRepo.updateEnrollmentStatus(enrollment.id, 'completed');
      logger.info({ msg: 'external_api_already_synced', traceId, enrollment_id: enrollment.id });
      return;
    }

    // Non-terminal error — mark retrying and rethrow so BullMQ schedules retry
    const nextAttemptAt = new Date(Date.now() + (classification.retryAfterMs || 30000));
    await repo.markRetrying(log.id, nextAttemptAt, err.message);

    throw err; // BullMQ will pick this up and retry per job options
  }

  // We have an HTTP response — evaluate status ourselves
  const statusCode = response.status;
  durationMs = Date.now() - startMs;

  if (statusCode >= 200 && statusCode < 300) {
    await repo.markSuccess(log.id, response.data || null, statusCode, durationMs);
    await enrollmentRepo.updateEnrollmentStatus(enrollment.id, 'completed');

    logger.info({
      msg: 'external_api_sync_success',
      traceId,
      enrollment_id: enrollment.id,
      log_id: log.id,
      status_code: statusCode,
      duration_ms: durationMs,
    });
    return;
  }

  // Construct a synthetic error so classify() can inspect response.status
  const httpErr = new Error(`HTTP ${statusCode}`);
  httpErr.response = response;
  // Tell the breaker this is a failure (opossum does not auto-fail on resolved calls)
  breaker.open();

  const classification = classify(httpErr);

  logger.warn({
    msg: 'external_api_sync_non_2xx',
    traceId,
    enrollment_id: enrollment.id,
    log_id: log.id,
    status_code: statusCode,
    reason: classification.reason,
    terminal: classification.terminal,
    duration_ms: durationMs,
  });

  if (classification.terminal) {
    await repo.markFailed(log.id, response.data || null, statusCode, durationMs, httpErr.message);
    return;
  }

  if (classification.reason === 'ALREADY_SYNCED') {
    await repo.markSuccess(log.id, response.data || null, statusCode, durationMs);
    await enrollmentRepo.updateEnrollmentStatus(enrollment.id, 'completed');
    return;
  }

  const nextAttemptAt = new Date(Date.now() + (classification.retryAfterMs || 30000));
  await repo.markRetrying(log.id, nextAttemptAt, httpErr.message);
  throw httpErr; // trigger BullMQ retry
}

module.exports = { syncEnrollment, syncEnrollmentInBackground };
