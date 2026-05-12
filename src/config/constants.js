'use strict';

module.exports = Object.freeze({
  // Pagination defaults
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 100,

  // Enrollment dedupe window in milliseconds (5 minutes)
  ENROLLMENT_DEDUPE_WINDOW_MS: 5 * 60 * 1000,

  // Razorpay currency
  RAZORPAY_CURRENCY: 'INR',

  // Phase 3A: default enrollment amount in paise (INR 999)
  // until the pricing module lands this is the single source of truth.
  DEFAULT_ENROLLMENT_AMOUNT_PAISE: 99900,

  // Phase 3A: prefix for human-readable enrollment codes
  ENROLLMENT_CODE_PREFIX: 'KS',

  // Defaults for the external-API sync payload. The external system requires
  // every field to be present (non-null). We use actual saved enrollment +
  // payment data wherever possible; these dummies fill the gap.
  EXTERNAL_API_DEFAULTS: {
    firstName: 'Demo',
    lastName: 'User',
    email: 'demo@example.com',
    phoneNumber: '+910000000000',
    plan: 'SUMAGO30',
    group: 'group_A',
    unit: 'unit_01',
    phase: 'phase_2',
    segment: 'enterprise',
    transactionId: 'txn_no_payment',
    amount: 0,
  },

  // Default international dialing prefix added to 10-digit phone numbers when
  // posting to the external API (the marketing form collects raw 10-digit numbers).
  DEFAULT_PHONE_COUNTRY_CODE: '+91',

  // HTTP status codes used across the app
  HTTP: {
    OK: 200,
    CREATED: 201,
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    CONFLICT: 409,
    UNPROCESSABLE: 422,
    INTERNAL: 500,
    SERVICE_UNAVAILABLE: 503,
  },

  // Error codes returned in the error envelope
  ERROR_CODES: {
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    UNAUTHORIZED: 'UNAUTHORIZED',
    FORBIDDEN: 'FORBIDDEN',
    PERMISSION_DENIED: 'PERMISSION_DENIED',
    NOT_FOUND: 'NOT_FOUND',
    CONFLICT: 'CONFLICT',
    PAYMENT_AMOUNT_MISMATCH: 'PAYMENT_AMOUNT_MISMATCH',
    PAYMENT_ALREADY_COMPLETED: 'PAYMENT_ALREADY_COMPLETED',
    DUPLICATE_WEBHOOK: 'DUPLICATE_WEBHOOK',
    INVALID_SIGNATURE: 'INVALID_SIGNATURE',
    INTERNAL_ERROR: 'INTERNAL_ERROR',
    EXTERNAL_API_ERROR: 'EXTERNAL_API_ERROR',
    FOLLOWUP_NOT_FOUND: 'FOLLOWUP_NOT_FOUND',
    FOLLOWUP_INVALID_TRANSITION: 'FOLLOWUP_INVALID_TRANSITION',
    CANNOT_MODIFY_SELF: 'CANNOT_MODIFY_SELF',
    CANNOT_DELETE_ACTIVE: 'CANNOT_DELETE_ACTIVE',
    UNSUPPORTED_REPORT_TYPE: 'UNSUPPORTED_REPORT_TYPE',
    // Phase 3A: auth change-password error codes
    INVALID_CURRENT_PASSWORD: 'INVALID_CURRENT_PASSWORD',
    SAME_PASSWORD: 'SAME_PASSWORD',
    // Plans
    PLAN_NOT_SELECTED: 'PLAN_NOT_SELECTED',
    PLAN_INACTIVE: 'PLAN_INACTIVE',
    PLAN_PRICING_INACTIVE: 'PLAN_PRICING_INACTIVE',
    PLAN_PRICING_NOT_FOUND: 'PLAN_PRICING_NOT_FOUND',
    // Admin enrollments
    CSV_INVALID_HEADERS: 'CSV_INVALID_HEADERS',
    CSV_TOO_LARGE: 'CSV_TOO_LARGE',
  },

  // BullMQ queue names
  QUEUES: {
    EXTERNAL_API_SYNC: 'external-api-sync',
  },

  // Granular permission codes — these strings are stored in the permissions table
  // and seeded via src/prisma/seed.js. Route guards reference these constants.
  PERMISSIONS: {
    // Enrollments
    ENROLLMENTS_VIEW: 'enrollments:view',
    // Payments
    PAYMENTS_VIEW: 'payments:view',
    PAYMENTS_RETRY: 'payments:retry',
    // Followups
    FOLLOWUPS_VIEW: 'followups:view',
    FOLLOWUPS_MANAGE: 'followups:manage',
    // Razorpay configs
    RAZORPAY_CONFIGS_MANAGE: 'razorpay_configs:manage',
    // Users
    USERS_MANAGE: 'users:manage',
    // Reports
    REPORTS_VIEW: 'reports:view',
    // External API logs
    EXTERNAL_API_LOGS_VIEW: 'external_api_logs:view',
    // Audit logs
    AUDIT_LOGS_VIEW: 'audit_logs:view',
    // Courses
    COURSES_VIEW: 'courses:view',
    COURSES_MANAGE: 'courses:manage',
    // Education Master
    EDUCATION_MASTER_VIEW: 'educationMaster:view',
    EDUCATION_MASTER_MANAGE: 'educationMaster:manage',
    // Duration Master
    DURATION_MASTER_VIEW: 'durationMaster:view',
    DURATION_MASTER_MANAGE: 'durationMaster:manage',
    // Webhooks admin
    WEBHOOKS_VIEW: 'webhooks:view',
    WEBHOOKS_TEST: 'webhooks:test',
    // Plans
    PLANS_READ:              'plans:read',
    PLANS_CREATE:            'plans:create',
    PLANS_UPDATE:            'plans:update',
    PLANS_DELETE:            'plans:delete',
    PLANS_ENROLLMENTS_READ:  'plans:enrollments:read',
    // Admin Enrollments
    ENROLLMENTS_MANUAL_CREATE: 'enrollments:manual:create',
    ENROLLMENTS_BULK_UPLOAD:   'enrollments:bulk:upload',
  },
});
