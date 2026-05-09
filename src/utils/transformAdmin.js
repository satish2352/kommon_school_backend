'use strict';

/**
 * Admin response-shape transformer utilities.
 * Used by all admin endpoints that must serve camelCase to the React frontend.
 */

// ---------------------------------------------------------------------------
// Status mappers
// ---------------------------------------------------------------------------

const PAYMENT_STATUS_MAP = {
  success:   'SUCCESS',
  failed:    'FAILED',
  expired:   'EXPIRED',
  pending:   'PENDING',
  initiated: 'CREATED',
  cancelled: 'FAILED',
  refunded:  'REFUNDED',
  partial:   'PARTIAL',
};

/**
 * Map a lowercase payment status string to the UPPERCASE variant the frontend expects.
 *
 * @param {string|undefined} s
 * @returns {string}
 */
function mapPaymentStatus(s) {
  if (!s) return 'UNKNOWN';
  return PAYMENT_STATUS_MAP[s.toLowerCase()] || s.toUpperCase();
}

const ENROLLMENT_STATUS_MAP = {
  submitted:    'SUBMITTED',
  paid:         'PAID',
  sync_pending: 'SYNC_PENDING',
  completed:    'COMPLETED',
  failed:       'FAILED',
  expired:      'EXPIRED',
  cancelled:    'CANCELLED',
};

/**
 * Map a lowercase enrollment status string to UPPERCASE.
 *
 * @param {string|undefined} s
 * @returns {string}
 */
function mapEnrollmentStatus(s) {
  if (!s) return 'UNKNOWN';
  return ENROLLMENT_STATUS_MAP[s.toLowerCase()] || s.toUpperCase();
}

const EXTERNAL_API_STATUS_MAP = {
  pending:   'PENDING',
  success:   'SUCCESS',
  failed:    'FAILED',
  retrying:  'RETRYING',
  dead_letter: 'DEAD_LETTER',
};

/**
 * Map a lowercase external API log status to UPPERCASE.
 *
 * @param {string|undefined} s
 * @returns {string}
 */
function mapExternalApiStatus(s) {
  if (!s) return 'UNKNOWN';
  return EXTERNAL_API_STATUS_MAP[s.toLowerCase()] || s.toUpperCase();
}

// ---------------------------------------------------------------------------
// Enrollment summary picker
// ---------------------------------------------------------------------------

/**
 * Extract a minimal camelCase enrollment summary used by payment and log responses.
 *
 * @param {object|null} e — raw Prisma enrollment row (may include extra fields)
 * @returns {{ id: string, enrollmentId: string, fullName: string|null, email: string, phone: string|null }|null}
 */
function pickEnrollmentSummary(e) {
  if (!e) return null;
  const fullName =
    e.name ||
    [`${e.first_name || ''}`.trim(), `${e.last_name || ''}`.trim()]
      .filter(Boolean)
      .join(' ') ||
    null;
  return {
    id:           e.id,
    enrollmentId: e.enrollment_code || e.id,
    fullName,
    email:        e.email || null,
    phone:        e.phone_number || null,
  };
}

module.exports = {
  mapPaymentStatus,
  mapEnrollmentStatus,
  mapExternalApiStatus,
  pickEnrollmentSummary,
};
