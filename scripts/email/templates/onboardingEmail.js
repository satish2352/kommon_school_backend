'use strict';

/**
 * onboardingEmail.js — builds the new-student onboarding email.
 *
 * Returns { subject, html, text }. The HTML uses table-based layout and inline
 * styles only (no <style> blocks, no external CSS) because that is the only
 * reliable way to render consistently across Gmail, Outlook, Apple Mail, etc.
 *
 * Pure function — no I/O. All dynamic values are HTML-escaped before
 * interpolation to avoid breaking the markup (and as defence-in-depth).
 */

/**
 * Escape a value for safe inclusion in HTML text/attribute context.
 * @param {unknown} value
 * @returns {string}
 */
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const BRAND = {
  name: 'Kommon School',
  tagline: 'AI Interview Practice Platform',
  // Matches the frontend gradient palette.
  primary: '#2563EB',
  primaryDark: '#1E3A8A',
  ink: '#0F172A',
  muted: '#64748B',
  border: '#E5E7EB',
  bg: '#F1F5F9',
  supportEmail: 'support@kommonschool.com',
};

/**
 * @param {object} params
 * @param {string} [params.name]            Student's full name (for greeting).
 * @param {string} params.username          Login username (their email).
 * @param {string} params.tempPassword      Generated temporary password.
 * @param {string} params.loginUrl          Application login URL.
 * @param {string} [params.enrollmentCode]  Human-friendly enrollment code.
 * @returns {{ subject: string, html: string, text: string }}
 */
function buildOnboardingEmail({ name, username, tempPassword, loginUrl, enrollmentCode }) {
  const firstName = (name && String(name).trim().split(/\s+/)[0]) || 'there';
  const safe = {
    firstName: escapeHtml(firstName),
    username: escapeHtml(username),
    tempPassword: escapeHtml(tempPassword),
    loginUrl: escapeHtml(loginUrl),
    enrollmentCode: enrollmentCode ? escapeHtml(enrollmentCode) : '',
  };

  const subject = `Welcome to ${BRAND.name} — Your login details inside`;

  // ---- Plain-text fallback -------------------------------------------------
  const text = [
    `Welcome to ${BRAND.name}, ${firstName}!`,
    '',
    'Your enrollment is confirmed and your account is ready.',
    enrollmentCode ? `Enrollment ID: ${enrollmentCode}` : null,
    '',
    'Your login credentials:',
    `  Login URL:  ${loginUrl}`,
    `  Username:   ${username}`,
    `  Password:   ${tempPassword}`,
    '',
    'For your security, please sign in and change this temporary password right away.',
    '',
    'Getting started:',
    '  1. Open the login URL above.',
    '  2. Sign in with your username and temporary password.',
    '  3. Change your password from the account menu.',
    '  4. Start practicing your AI-powered mock interviews.',
    '',
    `Need help? Reach us at ${BRAND.supportEmail}.`,
    '',
    `— The ${BRAND.name} Team`,
  ]
    .filter((line) => line !== null)
    .join('\n');

  // ---- HTML ----------------------------------------------------------------
  const enrollmentRow = safe.enrollmentCode
    ? `
              <tr>
                <td style="padding:4px 0;color:${BRAND.muted};font-size:13px;">Enrollment ID</td>
                <td style="padding:4px 0;color:${BRAND.ink};font-size:13px;font-weight:600;text-align:right;font-family:'Courier New',monospace;">${safe.enrollmentCode}</td>
              </tr>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="x-apple-disable-message-reformatting" />
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:${BRAND.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <span style="display:none;font-size:1px;color:${BRAND.bg};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">Your ${BRAND.name} account is ready — sign in with the credentials inside.</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${BRAND.bg};padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#ffffff;border-radius:14px;overflow:hidden;border:1px solid ${BRAND.border};">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,${BRAND.primary},${BRAND.primaryDark});padding:32px 32px 28px;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="width:44px;vertical-align:middle;">
                    <div style="width:44px;height:44px;border-radius:12px;background-color:rgba(255,255,255,0.18);text-align:center;line-height:44px;color:#ffffff;font-size:22px;font-weight:800;">K</div>
                  </td>
                  <td style="padding-left:12px;vertical-align:middle;">
                    <div style="color:#ffffff;font-size:18px;font-weight:700;line-height:1.1;">${BRAND.name}</div>
                    <div style="color:rgba(255,255,255,0.75);font-size:12px;">${BRAND.tagline}</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px 32px 8px;">
              <h1 style="margin:0 0 12px;color:${BRAND.ink};font-size:22px;font-weight:700;">Welcome, ${safe.firstName}! 🎉</h1>
              <p style="margin:0 0 20px;color:${BRAND.muted};font-size:15px;line-height:1.6;">
                Your enrollment is confirmed and your account is ready. Use the credentials below to sign in and start practicing AI-powered mock interviews.
              </p>

              <!-- Credentials card -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F8FAFC;border:1px solid ${BRAND.border};border-radius:12px;margin:0 0 24px;">
                <tr>
                  <td style="padding:18px 20px;">
                    <div style="color:${BRAND.ink};font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:12px;">Your login credentials</div>
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding:4px 0;color:${BRAND.muted};font-size:13px;">Username</td>
                        <td style="padding:4px 0;color:${BRAND.ink};font-size:13px;font-weight:600;text-align:right;">${safe.username}</td>
                      </tr>
                      <tr>
                        <td style="padding:4px 0;color:${BRAND.muted};font-size:13px;">Temporary password</td>
                        <td style="padding:4px 0;color:${BRAND.ink};font-size:14px;font-weight:700;text-align:right;font-family:'Courier New',monospace;letter-spacing:0.5px;">${safe.tempPassword}</td>
                      </tr>${enrollmentRow}
                    </table>
                  </td>
                </tr>
              </table>

              <!-- CTA button -->
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 24px;">
                <tr>
                  <td align="center" style="border-radius:10px;background:linear-gradient(135deg,${BRAND.primary},${BRAND.primaryDark});">
                    <a href="${safe.loginUrl}" target="_blank" style="display:inline-block;padding:13px 34px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;border-radius:10px;">
                      Log in to your account &rarr;
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 24px;color:${BRAND.muted};font-size:12px;line-height:1.5;text-align:center;">
                Or paste this link into your browser:<br />
                <a href="${safe.loginUrl}" target="_blank" style="color:${BRAND.primary};word-break:break-all;">${safe.loginUrl}</a>
              </p>

              <!-- Security note -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#FEF9E7;border:1px solid #FCE8B2;border-radius:10px;margin:0 0 24px;">
                <tr>
                  <td style="padding:14px 18px;color:#92660E;font-size:13px;line-height:1.5;">
                    🔒 <strong>For your security:</strong> this is a temporary password. Please change it from your account settings immediately after your first sign-in.
                  </td>
                </tr>
              </table>

              <!-- Getting started -->
              <div style="color:${BRAND.ink};font-size:14px;font-weight:700;margin-bottom:10px;">Getting started</div>
              <ol style="margin:0 0 8px;padding-left:20px;color:${BRAND.muted};font-size:14px;line-height:1.7;">
                <li>Open the login link above.</li>
                <li>Sign in with your username and temporary password.</li>
                <li>Change your password from the account menu.</li>
                <li>Start your first AI-powered mock interview.</li>
              </ol>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px 28px;border-top:1px solid ${BRAND.border};">
              <p style="margin:0 0 6px;color:${BRAND.muted};font-size:13px;line-height:1.5;">
                Need help? Contact us at <a href="mailto:${BRAND.supportEmail}" style="color:${BRAND.primary};text-decoration:none;">${BRAND.supportEmail}</a>.
              </p>
              <p style="margin:0;color:#94A3B8;font-size:12px;">
                &copy; ${BRAND.name}. You received this email because an account was created for ${safe.username}.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, html, text };
}

module.exports = { buildOnboardingEmail, escapeHtml };
