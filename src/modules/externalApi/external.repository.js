'use strict';

const { getPrismaClient } = require('../../config/database');

function getDb() {
  return getPrismaClient();
}

/**
 * Insert a new external_api_logs row in `pending` status.
 *
 * @param {{ enrollment_id: string, payment_id?: string, endpoint: string, request_body: object }} data
 */
async function createLog(data) {
  return getDb().externalApiLog.create({
    data: {
      enrollment_id: data.enrollment_id,
      payment_id: data.payment_id || null,
      endpoint: data.endpoint,
      request_body: data.request_body,
      status: 'pending',
    },
  });
}

/**
 * Generic patch — prefer the semantic helpers below for state transitions.
 *
 * @param {string} id
 * @param {object} patch  — Prisma update data object
 */
async function updateLog(id, patch) {
  return getDb().externalApiLog.update({
    where: { id },
    data: patch,
  });
}

/**
 * Find the latest non-terminal log row for a given enrollment.
 * Terminal statuses are `success`, `failed`, and `dead_letter`.
 */
async function findActiveLogForEnrollment(enrollmentId) {
  return getDb().externalApiLog.findFirst({
    where: {
      enrollment_id: enrollmentId,
      status: { notIn: ['success', 'failed', 'dead_letter'] },
    },
    orderBy: { created_at: 'desc' },
  });
}

/**
 * Transition a log row to `retrying`. Increments attempts counter.
 *
 * @param {string}   id
 * @param {Date}     nextAttemptAt
 * @param {string}   error        — last error message (PII-free)
 */
async function markRetrying(id, nextAttemptAt, error) {
  return getDb().externalApiLog.update({
    where: { id },
    data: {
      status: 'retrying',
      attempts: { increment: 1 },
      next_attempt_at: nextAttemptAt,
      last_error: error ? String(error).slice(0, 2000) : null,
    },
  });
}

/**
 * Transition a log row to `success`.
 *
 * @param {string}  id
 * @param {object}  responseBody
 * @param {number}  statusCode
 * @param {number}  durationMs
 */
async function markSuccess(id, responseBody, statusCode, durationMs) {
  return getDb().externalApiLog.update({
    where: { id },
    data: {
      status: 'success',
      response_body: responseBody || null,
      status_code: statusCode,
      duration_ms: durationMs,
      last_error: null,
      next_attempt_at: null,
    },
  });
}

/**
 * Transition a log row to `failed` (terminal — no more retries).
 *
 * @param {string}  id
 * @param {object}  responseBody
 * @param {number}  statusCode
 * @param {number}  durationMs
 * @param {string}  error
 */
async function markFailed(id, responseBody, statusCode, durationMs, error) {
  return getDb().externalApiLog.update({
    where: { id },
    data: {
      status: 'failed',
      response_body: responseBody || null,
      status_code: statusCode,
      duration_ms: durationMs,
      last_error: error ? String(error).slice(0, 2000) : null,
      next_attempt_at: null,
    },
  });
}

/**
 * Transition a log row to `dead_letter` after all retry attempts are exhausted.
 *
 * @param {string} id
 * @param {string} error
 */
async function markDeadLetter(id, error) {
  return getDb().externalApiLog.update({
    where: { id },
    data: {
      status: 'dead_letter',
      last_error: error ? String(error).slice(0, 2000) : null,
      next_attempt_at: null,
    },
  });
}

/**
 * Paginated list of external API logs for admin viewers.
 * Enrollments are eager-loaded with identity fields only (no full request body).
 *
 * @param {{ skip: number, take: number, where: object, orderBy: object }} opts
 * @returns {Promise<{ rows: object[], total: number }>}
 */
async function listLogsByQuery({ skip, take, where, orderBy }) {
  const db = getDb();
  const [rows, total] = await db.$transaction([
    db.externalApiLog.findMany({
      skip,
      take,
      where,
      orderBy,
      select: {
        id: true,
        enrollment_id: true,
        payment_id: true,
        endpoint: true,
        status: true,
        status_code: true,
        attempts: true,
        last_error: true,
        duration_ms: true,
        next_attempt_at: true,
        created_at: true,
        updated_at: true,
        enrollment: {
          select: {
            id: true,
            email: true,
            first_name: true,
            last_name: true,
            phone_number: true,
          },
        },
      },
    }),
    db.externalApiLog.count({ where }),
  ]);
  return { rows, total };
}

/**
 * Find a single external API log by ID, including full request/response payloads.
 *
 * @param {string} id
 * @returns {Promise<object|null>}
 */
async function findLogById(id) {
  return getDb().externalApiLog.findUnique({
    where: { id },
    include: {
      enrollment: {
        select: {
          id: true,
          email: true,
          first_name: true,
          last_name: true,
          phone_number: true,
        },
      },
    },
  });
}

module.exports = {
  createLog,
  updateLog,
  findActiveLogForEnrollment,
  markRetrying,
  markSuccess,
  markFailed,
  markDeadLetter,
  listLogsByQuery,
  findLogById,
};
