'use strict';

/**
 * enrollmentOnboarding.service.js
 *
 * After a brand-new enrollment record is created, provision a login account
 * for the student and send them an onboarding email with their credentials.
 *
 * Security posture:
 *   - Temporary passwords are generated with the CSPRNG (crypto.randomInt),
 *     stored only as a bcrypt hash, and never logged.
 *   - New accounts get role='student' (zero admin permissions).
 *   - If a user already exists for the email we DO NOT touch it (it could be an
 *     admin). We skip provisioning so an enrollment can never reset an existing
 *     account's password or escalate/downgrade its role.
 *   - This function never throws: provisioning is best-effort and must not
 *     break the enrollment API response. All failures are logged.
 */

const crypto = require('crypto');
const { getPrismaClient } = require('../../config/database');
const { hashPassword } = require('../../utils/crypto');
const logger = require('../../config/logger');
const env = require('../../config/env');
const { sendOnboardingEmail } = require('../../../scripts/email');
const emailLogRepo = require('../admin/emailLogs/emailLog.repository');
const siteSettingsService = require('../siteSettings/siteSettings.service');

// Unambiguous character sets (no O/0, I/l/1) so a temp password read off an
// email is easy to type correctly.
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const DIGITS = '23456789';
const SYMBOLS = '@#$%&*!?';
const ALL = UPPER + LOWER + DIGITS + SYMBOLS;

const TEMP_PASSWORD_LENGTH = 12;

function pick(charset) {
  return charset[crypto.randomInt(0, charset.length)];
}

/**
 * Cryptographically-strong shuffle (Fisher–Yates with crypto.randomInt).
 * @param {string[]} arr
 * @returns {string[]}
 */
function secureShuffle(arr) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(0, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Generate a temporary password that always contains at least one upper, one
 * lower, one digit and one symbol (so it satisfies common password policies).
 * @returns {string}
 */
function generateTempPassword() {
  const required = [pick(UPPER), pick(LOWER), pick(DIGITS), pick(SYMBOLS)];
  const rest = Array.from({ length: TEMP_PASSWORD_LENGTH - required.length }, () => pick(ALL));
  return secureShuffle([...required, ...rest]).join('');
}

function maskEmail(email) {
  if (!email || typeof email !== 'string' || !email.includes('@')) return 'unknown';
  const [local, domain] = email.split('@');
  return `${local[0]}***@${domain}`;
}

/**
 * Send the onboarding email AND persist the outcome to email_logs so the admin
 * panel can show who mail went to (and whether it succeeded). Best-effort: the
 * email send already swallows its own errors; here we just translate its result
 * into a log row. Shared by the automatic enrollment flow and the admin resend.
 *
 * @param {object} p
 * @param {string} p.to
 * @param {string} [p.name]
 * @param {string} p.tempPassword
 * @param {string} [p.enrollmentCode]
 * @param {string} [p.enrollmentId]
 * @param {string} [p.userId]
 * @param {string} [p.traceId]
 * @param {string} [p.triggeredBy]  null = automatic; admin email = manual resend
 * @returns {Promise<{sent:boolean, skipped?:boolean, messageId?:string, error?:string}>}
 */
async function sendOnboardingAndLog({ to, name, tempPassword, enrollmentCode, enrollmentId, userId, traceId, triggeredBy }) {
  // Dynamic brand name from site settings (best-effort: fall back silently so a
  // settings hiccup never blocks onboarding email).
  let brandName = 'Kommon School';
  try {
    const settings = await siteSettingsService.getSettings();
    if (settings?.brandName) brandName = settings.brandName;
  } catch { /* keep default brand name */ }

  const result = await sendOnboardingEmail({
    to,
    name,
    username: to,
    tempPassword,
    loginUrl: env.FRONTEND_LOGIN_URL,
    enrollmentCode: enrollmentCode || null,
    brandName,
    traceId,
  });

  await emailLogRepo.record({
    toEmail: to,
    type: 'onboarding',
    status: result.sent ? 'sent' : (result.skipped ? 'skipped' : 'failed'),
    messageId: result.messageId ?? null,
    error: result.error ?? null,
    subject: `Your ${brandName} account`,
    reason: result.skipped ? 'mail disabled or not configured' : null,
    enrollmentId: enrollmentId ?? null,
    userId: userId ?? null,
    traceId,
    triggeredBy: triggeredBy ?? null,
  });

  return result;
}

/**
 * Provision a student login account for a freshly-created enrollment and send
 * the onboarding email. Idempotent + non-throwing.
 *
 * @param {object} params
 * @param {object} params.enrollment  The created enrollment row (needs email,
 *                                     and optionally name + enrollment_code).
 * @param {string} [params.traceId]
 * @returns {Promise<{provisioned: boolean, userId?: string, reason?: string}>}
 */
async function onboardNewEnrollment({ enrollment, traceId }) {
  const email = enrollment && enrollment.email;
  if (!email) {
    logger.warn({ msg: 'onboarding_skipped_no_email', traceId, enrollment_id: enrollment && enrollment.id });
    return { provisioned: false, reason: 'no_email' };
  }

  const db = getPrismaClient();

  try {
    // Never overwrite an existing account (it may be an admin/staff user).
    const existing = await db.user.findFirst({ where: { email }, select: { id: true } });
    if (existing) {
      logger.info({
        msg: 'onboarding_skipped_user_exists',
        traceId,
        enrollment_id: enrollment.id,
        email: maskEmail(email),
      });
      // Log the skip so the admin panel explains *why* no mail went out and can
      // offer a resend (which will reset the password for this existing account).
      await emailLogRepo.record({
        toEmail: email,
        type: 'onboarding',
        status: 'skipped',
        reason: 'account already exists',
        enrollmentId: enrollment.id,
        userId: existing.id,
        traceId,
      });
      return { provisioned: false, reason: 'user_exists' };
    }

    const tempPassword = generateTempPassword();
    const passwordHash = await hashPassword(tempPassword);

    let user;
    try {
      user = await db.user.create({
        data: { email, password_hash: passwordHash, role: 'student' },
        select: { id: true, email: true },
      });
    } catch (e) {
      // Unique-violation race: another request created the account between our
      // check and insert. Treat as "already provisioned" and skip the email.
      if (e && e.code === 'P2002') {
        logger.info({
          msg: 'onboarding_skipped_user_race',
          traceId,
          enrollment_id: enrollment.id,
          email: maskEmail(email),
        });
        return { provisioned: false, reason: 'user_exists_race' };
      }
      throw e;
    }

    logger.info({
      msg: 'student_account_provisioned',
      traceId,
      user_id: user.id,
      enrollment_id: enrollment.id,
      email: maskEmail(email),
    });

    // ---------------------------------------------------------------------
    // Auto onboarding email DISABLED (per request): the public "Enroll Now"
    // flow now only SAVES the enrollment + provisions the login account and
    // moves the student straight to plan selection — it does NOT email the
    // credentials at submit time. The temp password above is still set on the
    // account; admins deliver it on demand via the "Resend credentials" button
    // (emailLog.service.resendOnboarding), which resets the password and sends.
    // To re-enable automatic send, uncomment the block below.
    // ---------------------------------------------------------------------
    // setImmediate(() => {
    //   sendOnboardingAndLog({
    //     to: email,
    //     name: enrollment.name || [enrollment.first_name, enrollment.last_name].filter(Boolean).join(' '),
    //     tempPassword,
    //     enrollmentCode: enrollment.enrollment_code || null,
    //     enrollmentId: enrollment.id,
    //     userId: user.id,
    //     traceId,
    //   }).catch((err) => {
    //     logger.error({
    //       msg: 'onboarding_email_unexpected_error',
    //       traceId,
    //       enrollment_id: enrollment.id,
    //       email: maskEmail(email),
    //       error: err.message,
    //     });
    //   });
    // });

    return { provisioned: true, userId: user.id };
  } catch (err) {
    logger.error({
      msg: 'onboarding_provision_failed',
      traceId,
      enrollment_id: enrollment.id,
      email: maskEmail(email),
      error: err.message,
    });
    return { provisioned: false, reason: 'error' };
  }
}

module.exports = { onboardNewEnrollment, generateTempPassword, sendOnboardingAndLog };
