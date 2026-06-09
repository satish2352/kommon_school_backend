'use strict';

/**
 * sendOnboardingEmail.js — high-level "send the onboarding email" entry point.
 *
 * Responsibilities:
 *   - Skip gracefully (never throw) when email is disabled/unconfigured.
 *   - Build the template, send via the shared transport.
 *   - Retry transient SMTP failures with exponential backoff.
 *   - Structured logging on every outcome; secrets (password) never logged.
 *
 * Returns a result object instead of throwing so callers (the enrollment flow)
 * can treat email as best-effort without wrapping every call in try/catch:
 *   { sent: boolean, skipped?: boolean, messageId?: string, previewUrl?: string, error?: string }
 */

const nodemailer = require('nodemailer');
const { getTransport, isMailEnabled, getFromAddress } = require('./mailer');
const { buildOnboardingEmail } = require('./templates/onboardingEmail');
const logger = require('../../src/config/logger');

const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 500;

/** Mask an email for logs: "jane.doe@x.com" => "j***@x.com". */
function maskEmail(email) {
  if (!email || typeof email !== 'string' || !email.includes('@')) return 'unknown';
  const [local, domain] = email.split('@');
  return `${local[0]}***@${domain}`;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Send the new-student onboarding email.
 *
 * @param {object} params
 * @param {string} params.to             Recipient email (also the username).
 * @param {string} [params.name]         Student full name (for greeting).
 * @param {string} params.username       Login username.
 * @param {string} params.tempPassword   Generated temporary password.
 * @param {string} params.loginUrl       Application login URL.
 * @param {string} [params.enrollmentCode]
 * @param {string} [params.traceId]      Correlation id for logs.
 * @returns {Promise<{sent:boolean, skipped?:boolean, messageId?:string, previewUrl?:string, error?:string}>}
 */
async function sendOnboardingEmail({ to, name, username, tempPassword, loginUrl, enrollmentCode, brandName, traceId }) {
  if (!isMailEnabled()) {
    logger.warn({
      msg: 'onboarding_email_skipped_disabled',
      traceId,
      to: maskEmail(to),
      reason: 'MAIL_ENABLED is false or SMTP is not fully configured',
    });
    return { sent: false, skipped: true };
  }

  const { subject, html, text } = buildOnboardingEmail({ name, username, tempPassword, loginUrl, enrollmentCode, brandName });
  const transport = getTransport();
  const message = { from: getFromAddress(), to, subject, html, text };

  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const info = await transport.sendMail(message);
      const previewUrl = nodemailer.getTestMessageUrl ? nodemailer.getTestMessageUrl(info) : undefined;
      logger.info({
        msg: 'onboarding_email_sent',
        traceId,
        to: maskEmail(to),
        messageId: info.messageId,
        attempt,
        ...(previewUrl ? { previewUrl } : {}),
      });
      return { sent: true, messageId: info.messageId, ...(previewUrl ? { previewUrl } : {}) };
    } catch (err) {
      lastError = err;
      logger.error({
        msg: 'onboarding_email_attempt_failed',
        traceId,
        to: maskEmail(to),
        attempt,
        maxAttempts: MAX_ATTEMPTS,
        error: err.message,
        code: err.code,
      });
      if (attempt < MAX_ATTEMPTS) {
        await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1));
      }
    }
  }

  logger.error({
    msg: 'onboarding_email_failed',
    traceId,
    to: maskEmail(to),
    attempts: MAX_ATTEMPTS,
    error: lastError ? lastError.message : 'unknown',
  });
  return { sent: false, error: lastError ? lastError.message : 'unknown' };
}

module.exports = { sendOnboardingEmail };
