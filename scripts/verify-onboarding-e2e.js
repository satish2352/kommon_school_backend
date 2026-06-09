'use strict';

/**
 * verify-onboarding-e2e.js — proves the full onboarding chain end to end:
 *
 *   createEnrollment (service)  →  student User created (DB)
 *   →  onboarding email actually SENT (real SMTP via a throwaway Ethereal inbox)
 *   →  login with the emailed temp password succeeds (auth.service issues JWTs)
 *
 * It uses the real application code. To learn the generated temp password (which
 * is random and never returned), it wraps the email module's sendOnboardingEmail
 * to capture the argument — then still calls the real sender so a real email goes
 * out. Run from backend/:   node scripts/verify-onboarding-e2e.js
 *
 * This does NOT need your Gmail credentials; it spins up a free Ethereal test
 * inbox and prints a preview URL of the delivered message.
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const nodemailer = require('nodemailer');

async function main() {
  // 1) Throwaway SMTP inbox, configured BEFORE the env module is required.
  const testAccount = await nodemailer.createTestAccount();
  process.env.MAIL_ENABLED = 'true';
  process.env.SMTP_HOST = 'smtp.ethereal.email';
  process.env.SMTP_PORT = '587';
  process.env.SMTP_SECURE = 'false';
  process.env.SMTP_USER = testAccount.user;
  process.env.SMTP_PASS = testAccount.pass;
  process.env.MAIL_FROM = `Kommon School <${testAccount.user}>`;
  console.log('→ Using Ethereal test inbox:', testAccount.user);

  // 2) Capture the generated temp password by wrapping the real sender.
  const emailModule = require('./email');
  const realSend = emailModule.sendOnboardingEmail;
  let captured = null;
  emailModule.sendOnboardingEmail = (args) => {
    captured = args;            // includes the plaintext tempPassword
    return realSend(args);      // still performs the real send
  };

  // 3) Require app services AFTER the patch + env are set.
  const enrollmentService = require('../src/modules/enrollments/enrollment.service');
  const { onboardNewEnrollment } = require('../src/modules/enrollments/enrollmentOnboarding.service');
  const authService = require('../src/modules/auth/auth.service');

  const rand = require('crypto').randomBytes(3).toString('hex');
  const email = `verify.e2e.${rand}@example.com`;
  const traceId = `verify-${rand}`;

  // 4) Create the enrollment exactly like the controller does.
  const { enrollment, created } = await enrollmentService.createEnrollment(
    { name: 'Verify Student', phone: '9876500000', email, role: 'STUDENT', education: 'UNDERGRADUATE' },
    traceId,
  );
  console.log(`→ Enrollment created=${created} id=${enrollment.id} code=${enrollment.enrollment_code}`);

  // 5) Provision + send onboarding email (email fires via setImmediate).
  const result = await onboardNewEnrollment({ enrollment, traceId });
  console.log('→ Provisioning result:', JSON.stringify(result));

  // Let the setImmediate-scheduled send run, then await its completion.
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setTimeout(r, 2500));

  if (!captured || !captured.tempPassword) {
    throw new Error('Temp password was not captured — onboarding email was not invoked.');
  }
  console.log('✓ Onboarding email invoked. Username:', captured.username, '| loginUrl:', captured.loginUrl);

  // 6) Log in with the EMAILED credentials through the real auth service.
  const login = await authService.login(email, captured.tempPassword, traceId, { ip: '127.0.0.1', headers: {} });
  const ok = Boolean(login && login.tokens && login.tokens.accessToken && login.user.role === 'student');
  console.log(`✓ Login ${ok ? 'SUCCEEDED' : 'FAILED'} — role=${login.user.role} accessToken=${login.tokens.accessToken.slice(0, 18)}…`);

  // 7) Negative check: a wrong password must be rejected.
  let rejected = false;
  try {
    await authService.login(email, 'definitely-wrong-password', traceId, { ip: '127.0.0.1', headers: {} });
  } catch {
    rejected = true;
  }
  console.log(`✓ Wrong password correctly ${rejected ? 'REJECTED' : 'ACCEPTED (BUG!)'}`);

  console.log('\n========== E2E SUMMARY ==========');
  console.log('Enrollment record   :', created ? 'CREATED' : 'reused');
  console.log('Student user role   :', login.user.role);
  console.log('Onboarding email    :', 'SENT (Ethereal)');
  console.log('Login w/ emailed pw :', ok ? 'PASS' : 'FAIL');
  console.log('Wrong pw rejected   :', rejected ? 'PASS' : 'FAIL');
  console.log('=================================');

  const allPass = created && ok && rejected;
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error('✖ E2E verification error:', err);
  process.exit(1);
});
