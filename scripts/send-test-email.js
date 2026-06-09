'use strict';

/**
 * send-test-email.js — verify SMTP configuration and (optionally) send a
 * sample onboarding email.
 *
 * Usage (from the backend/ directory):
 *   node scripts/send-test-email.js                 # verify SMTP connectivity only
 *   node scripts/send-test-email.js you@example.com # verify + send a sample email
 *
 * Requires MAIL_ENABLED=true and the SMTP_* vars filled in .env.
 */

// Load env BEFORE requiring the email modules (they read the validated env).
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

const { verifyTransport, sendOnboardingEmail, isMailEnabled } = require('./email');
const env = require('../src/config/env');

async function main() {
  const recipient = process.argv[2];

  if (!isMailEnabled()) {
    console.error('✖ Email is not enabled. Set MAIL_ENABLED=true and SMTP_HOST/USER/PASS in .env, then retry.');
    process.exit(1);
  }

  console.log(`→ Verifying SMTP connection to ${env.SMTP_HOST}:${env.SMTP_PORT} (secure=${env.SMTP_SECURE}) ...`);
  try {
    await verifyTransport();
    console.log('✓ SMTP connection + credentials OK.');
  } catch (err) {
    console.error('✖ SMTP verification failed:', err.message);
    process.exit(1);
  }

  if (!recipient) {
    console.log('\nNo recipient supplied — connectivity check only.');
    console.log('To send a sample email:  node scripts/send-test-email.js you@example.com');
    process.exit(0);
  }

  console.log(`→ Sending sample onboarding email to ${recipient} ...`);
  const result = await sendOnboardingEmail({
    to: recipient,
    name: 'Test Student',
    username: recipient,
    tempPassword: 'Sample@1234',
    loginUrl: env.FRONTEND_LOGIN_URL,
    enrollmentCode: 'KS-TEST-000000',
    traceId: 'send-test-email',
  });

  if (result.sent) {
    console.log('✓ Email sent. messageId:', result.messageId);
    if (result.previewUrl) console.log('  Preview URL:', result.previewUrl);
    process.exit(0);
  } else {
    console.error('✖ Email send failed:', result.error || '(skipped)');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('✖ Unexpected error:', err);
  process.exit(1);
});
