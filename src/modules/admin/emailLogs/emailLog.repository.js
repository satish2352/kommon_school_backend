'use strict';

/**
 * emailLog.repository.js
 *
 * Data access for the `email_logs` audit table. Implemented with raw SQL
 * (parameterised) rather than the Prisma model so it works without a client
 * regenerate — the same reason the codebase already uses $queryRaw for the
 * enrollment FOR UPDATE locks. The Prisma `EmailLog` model still documents the
 * table and backs the migration.
 */

const { getPrismaClient } = require('../../../config/database');
const logger = require('../../../config/logger');

function getDb() {
  return getPrismaClient();
}

/**
 * Insert one email-log row. Best-effort + non-throwing: logging an email
 * outcome must never break the flow that sent (or skipped) the email.
 *
 * @param {object} entry
 * @param {string}  entry.toEmail
 * @param {'sent'|'failed'|'skipped'} entry.status
 * @param {string} [entry.type='onboarding']
 * @param {string} [entry.messageId]
 * @param {string} [entry.error]
 * @param {string} [entry.subject]
 * @param {string} [entry.reason]
 * @param {string} [entry.enrollmentId]
 * @param {string} [entry.userId]
 * @param {string} [entry.traceId]
 * @param {string} [entry.triggeredBy]  null = automatic; email = admin resend
 * @returns {Promise<void>}
 */
async function record(entry) {
  try {
    await getDb().$executeRawUnsafe(
      `INSERT INTO "email_logs"
         ("to_email","type","status","message_id","error","subject","reason",
          "enrollment_id","user_id","trace_id","triggered_by")
       VALUES ($1,$2,$3::"EmailStatus",$4,$5,$6,$7,$8::uuid,$9::uuid,$10,$11)`,
      String(entry.toEmail || '').toLowerCase(),
      entry.type || 'onboarding',
      entry.status,
      entry.messageId ?? null,
      entry.error ?? null,
      entry.subject ?? null,
      entry.reason ?? null,
      entry.enrollmentId ?? null,
      entry.userId ?? null,
      entry.traceId ?? null,
      entry.triggeredBy ?? null,
    );
  } catch (err) {
    logger.error({ msg: 'email_log_record_failed', error: err.message, to: entry && entry.toEmail });
  }
}

/**
 * Paginated, filterable list of email-log rows (newest first).
 *
 * @param {object} opts
 * @param {number} opts.page
 * @param {number} opts.limit
 * @param {string} [opts.search]  ILIKE on to_email
 * @param {string} [opts.status]  sent | failed | skipped
 * @param {string} [opts.type]
 * @returns {Promise<{ rows: object[], total: number }>}
 */
async function list({ page = 1, limit = 25, search, status, type }) {
  const db = getDb();
  const where = [];
  const params = [];
  let i = 1;

  if (search && search.trim()) {
    where.push(`"to_email" ILIKE $${i}`);
    params.push(`%${search.trim()}%`);
    i += 1;
  }
  if (status) {
    where.push(`"status" = $${i}::"EmailStatus"`);
    params.push(status);
    i += 1;
  }
  if (type) {
    where.push(`"type" = $${i}`);
    params.push(type);
    i += 1;
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const skip = (page - 1) * limit;

  const rows = await db.$queryRawUnsafe(
    `SELECT "id","to_email","type","status","message_id","error","subject","reason",
            "enrollment_id","user_id","trace_id","triggered_by","created_at"
       FROM "email_logs"
       ${whereSql}
       ORDER BY "created_at" DESC
       LIMIT $${i} OFFSET $${i + 1}`,
    ...params, limit, skip,
  );

  const countRows = await db.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS count FROM "email_logs" ${whereSql}`,
    ...params,
  );
  const total = countRows && countRows[0] ? Number(countRows[0].count) : 0;

  return { rows, total };
}

module.exports = { record, list };
