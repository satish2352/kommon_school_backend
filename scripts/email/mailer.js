'use strict';

/**
 * mailer.js — lazily-constructed, reused Nodemailer SMTP transport.
 *
 * Reusable email infrastructure for the backend. Configuration is sourced
 * exclusively from the validated env module (src/config/env) so there is a
 * single source of truth for SMTP settings.
 *
 * The transport is created lazily on first use and cached for the process
 * lifetime (connection pooling enabled) so we don't open a fresh TCP/TLS
 * handshake per email.
 */

const nodemailer = require('nodemailer');
const env = require('../../src/config/env');
const logger = require('../../src/config/logger');

/** @type {import('nodemailer').Transporter | null} */
let cachedTransport = null;

/**
 * Whether email sending is configured + enabled. When false, callers should
 * skip sending (and log) rather than throw — enrollment must never break just
 * because SMTP isn't configured in a given environment.
 *
 * @returns {boolean}
 */
function isMailEnabled() {
  return Boolean(env.MAIL_ENABLED && env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);
}

/**
 * Resolve the From header. Falls back to the SMTP user when MAIL_FROM is blank.
 * @returns {string}
 */
function getFromAddress() {
  return (env.MAIL_FROM && env.MAIL_FROM.trim()) || env.SMTP_USER;
}

/**
 * Build (once) and return the shared SMTP transport.
 * Throws if mail is not enabled/configured — guard with isMailEnabled() first.
 *
 * @returns {import('nodemailer').Transporter}
 */
function getTransport() {
  if (!isMailEnabled()) {
    throw new Error('Email is not enabled or SMTP is not fully configured (set MAIL_ENABLED=true and SMTP_HOST/USER/PASS).');
  }
  if (cachedTransport) return cachedTransport;

  cachedTransport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE, // true => implicit TLS (465); false => STARTTLS (587)
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
    },
    pool: true,
    maxConnections: 3,
    maxMessages: 50,
  });

  logger.info({
    msg: 'mailer_transport_created',
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
  });

  return cachedTransport;
}

/**
 * Verify SMTP connectivity + credentials. Used by the test script and at
 * startup diagnostics. Resolves true on success, throws the underlying error
 * on failure so callers can surface it.
 *
 * @returns {Promise<boolean>}
 */
async function verifyTransport() {
  const transport = getTransport();
  await transport.verify();
  logger.info({ msg: 'mailer_transport_verified', host: env.SMTP_HOST });
  return true;
}

module.exports = { getTransport, verifyTransport, isMailEnabled, getFromAddress };
