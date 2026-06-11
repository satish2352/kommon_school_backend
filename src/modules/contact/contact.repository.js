'use strict';

const { Prisma } = require('@prisma/client');
const { getPrismaClient } = require('../../config/database');

// NOTE: The `contact_submissions` table already exists in the database, but the
// generated Prisma client may not yet carry the model (it is added to
// schema.prisma; `prisma generate` runs on next clean build). To avoid coupling
// to client regeneration, this repository talks to the table via parameterised
// raw SQL — safe against injection because every value is bound, never
// interpolated.

function db() {
  return getPrismaClient();
}

/**
 * Insert a new contact submission. id/status/timestamps use column defaults.
 * @returns {Promise<object>} the created row
 */
async function createSubmission({ name, email, phone, message, ipAddress, userAgent }) {
  const rows = await db().$queryRaw`
    INSERT INTO contact_submissions (name, email, phone, message, ip_address, user_agent)
    VALUES (${name}, ${email}, ${phone}, ${message}, ${ipAddress}, ${userAgent})
    RETURNING id, name, email, phone, message, status, admin_notes, created_at, updated_at;
  `;
  return rows[0];
}

/**
 * Paginated, filterable list. Filters: status (exact), search (name/email/phone/message).
 * @returns {Promise<{ rows: object[], total: number }>}
 */
async function listSubmissions({ skip, take, search, status }) {
  const conds = [Prisma.sql`TRUE`];
  if (status) {
    conds.push(Prisma.sql`status = ${status}::"ContactSubmissionStatus"`);
  }
  if (search && search.trim()) {
    const like = `%${search.trim()}%`;
    conds.push(Prisma.sql`(name ILIKE ${like} OR email ILIKE ${like} OR phone ILIKE ${like} OR message ILIKE ${like})`);
  }
  const where = Prisma.join(conds, ' AND ');

  const rows = await db().$queryRaw`
    SELECT id, name, email, phone, message, status, admin_notes, created_at, updated_at
    FROM contact_submissions
    WHERE ${where}
    ORDER BY created_at DESC
    LIMIT ${take} OFFSET ${skip};
  `;
  const countRows = await db().$queryRaw`
    SELECT COUNT(*)::int AS n FROM contact_submissions WHERE ${where};
  `;
  return { rows, total: countRows[0]?.n ?? 0 };
}

/**
 * Update a submission's status. Returns the updated row, or null if not found.
 */
async function updateStatus(id, status) {
  const rows = await db().$queryRaw`
    UPDATE contact_submissions
    SET status = ${status}::"ContactSubmissionStatus", updated_at = now()
    WHERE id = ${id}::uuid
    RETURNING id, name, email, phone, message, status, admin_notes, created_at, updated_at;
  `;
  return rows[0] ?? null;
}

/**
 * Latest contact message per email, for a set of emails. Used to enrich the
 * Follow-ups report (type = website + description) without an extra per-row query.
 * @param {string[]} emails
 * @returns {Promise<Array<{ email: string, message: string, created_at: Date }>>}
 */
async function findLatestMessagesByEmails(emails) {
  if (!Array.isArray(emails) || emails.length === 0) return [];
  const lowered = [...new Set(emails.map((e) => String(e).toLowerCase()))];
  return db().$queryRaw`
    SELECT DISTINCT ON (lower(email)) lower(email) AS email, message, created_at
    FROM contact_submissions
    WHERE lower(email) IN (${Prisma.join(lowered)})
    ORDER BY lower(email), created_at DESC;
  `;
}

module.exports = {
  createSubmission,
  listSubmissions,
  updateStatus,
  findLatestMessagesByEmails,
};
