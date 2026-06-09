'use strict';

/**
 * emailLog.service.js
 *
 * Admin-facing operations for the email audit log:
 *   - listLogs:          paginated history of every onboarding email attempt.
 *   - resendOnboarding:  (re)send the onboarding credentials email for a given
 *                        student email. For an existing account this RESETS the
 *                        password (the old temp password is unrecoverable), then
 *                        emails the new one and revokes existing sessions.
 */

const { getPrismaClient } = require('../../../config/database');
const { hashPassword } = require('../../../utils/crypto');
const ApiError = require('../../../utils/ApiError');
const logger = require('../../../config/logger');
const repo = require('./emailLog.repository');
const {
  generateTempPassword,
  sendOnboardingAndLog,
} = require('../../enrollments/enrollmentOnboarding.service');

function getDb() {
  return getPrismaClient();
}

/**
 * Paginated list of email-log rows.
 * @param {object} query - { page, limit, search, status, type }
 * @returns {Promise<{ rows: object[], meta: object }>}
 */
async function listLogs(query, traceId) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 25));
  const { rows, total } = await repo.list({
    page,
    limit,
    search: query.search,
    status: query.status,
    type: query.type,
  });
  const totalPages = Math.ceil(total / limit) || 0;
  logger.info({ msg: 'email_logs_listed', traceId, page, limit, total });
  return { rows, meta: { page, limit, total, totalPages } };
}

/**
 * Resend the onboarding (credentials) email for a student email.
 *
 * - Existing student account → reset password to a new temp password, email it,
 *   and revoke all refresh tokens (old sessions can no longer continue).
 * - No account yet but the email is a known enrollment → provision a student
 *   account, then email the credentials.
 * - Email belongs to a staff/admin account → refuse (never reset staff creds
 *   through this path).
 * - Email is unknown (no enrollment, no user) → 404.
 *
 * @param {object} p - { email, actor, traceId }
 * @returns {Promise<{ to, accountAction, emailStatus, messageId, error }>}
 */
async function resendOnboarding({ email, actor, traceId }) {
  const to = String(email || '').trim().toLowerCase();
  if (!to) throw new ApiError(400, 'VALIDATION_ERROR', 'email is required');

  const db = getDb();

  const enrollment = await db.enrollment.findFirst({
    where: { email: to, deleted_at: null },
    orderBy: { created_at: 'desc' },
    select: { id: true, name: true, first_name: true, last_name: true, enrollment_code: true },
  });

  let user = await db.user.findFirst({
    where: { email: to },
    select: { id: true, email: true, role: true },
  });

  if (!enrollment && !user) {
    throw new ApiError(404, 'STUDENT_NOT_FOUND', 'No student found for this email.');
  }
  if (user && user.role !== 'student') {
    throw new ApiError(
      409,
      'NOT_A_STUDENT',
      'This email belongs to a staff account — onboarding resend is only for students.',
    );
  }

  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);

  let accountAction;
  if (user) {
    await db.user.update({ where: { id: user.id }, data: { password_hash: passwordHash } });
    // Changing the credential must invalidate existing sessions.
    await db.refreshToken.updateMany({
      where: { user_id: user.id, revoked_at: null },
      data: { revoked_at: new Date() },
    });
    accountAction = 'password_reset';
  } else {
    user = await db.user.create({
      data: { email: to, password_hash: passwordHash, role: 'student' },
      select: { id: true, email: true, role: true },
    });
    accountAction = 'account_created';
  }

  const name = enrollment
    ? (enrollment.name || [enrollment.first_name, enrollment.last_name].filter(Boolean).join(' '))
    : null;

  // Awaited so the admin sees the real send outcome immediately. This also
  // writes the email_logs row (with triggered_by = the admin).
  const result = await sendOnboardingAndLog({
    to,
    name,
    tempPassword,
    enrollmentCode: enrollment ? enrollment.enrollment_code : null,
    enrollmentId: enrollment ? enrollment.id : null,
    userId: user.id,
    traceId,
    triggeredBy: (actor && actor.email) || 'admin',
  });

  logger.info({
    msg: 'onboarding_email_resent',
    traceId,
    account_action: accountAction,
    email_status: result.sent ? 'sent' : (result.skipped ? 'skipped' : 'failed'),
    actor_id: actor && actor.id,
  });

  return {
    to,
    accountAction,
    emailStatus: result.sent ? 'sent' : (result.skipped ? 'skipped' : 'failed'),
    messageId: result.messageId || null,
    error: result.error || null,
  };
}

module.exports = { listLogs, resendOnboarding };
