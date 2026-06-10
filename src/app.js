'use strict';

require('dotenv').config();
require('./config/env'); // validates env on boot

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');

const requestLogger = require('./middleware/requestLogger.middleware');
const errorHandler = require('./middleware/errorHandler.middleware');
const webhookRaw = require('./middleware/webhookRaw.middleware');
const { globalLimiter } = require('./middleware/rateLimit.middleware');
const { getPrismaClient } = require('./config/database');
const { sendError } = require('./utils/ApiResponse');
const { HTTP, ERROR_CODES } = require('./config/constants');

const authRoutes = require('./modules/auth/auth.routes');
const enrollmentRoutes = require('./modules/enrollments/enrollment.routes');
const paymentRoutes = require('./modules/payments/payment.routes');
const followupRoutes = require('./modules/followups/followup.routes');
const webhookController = require('./modules/razorpay/webhook.controller');
const auditRoutes = require('./modules/audit/audit.routes');
const adminUserRoutes = require('./modules/admin/users/user.routes');
const adminRazorpayConfigRoutes = require('./modules/admin/razorpayConfigs/razorpayConfig.routes');
const adminExternalApiLogRoutes = require('./modules/admin/externalApiLogs/externalApiLog.routes');
const reportsRoutes = require('./modules/reports/reports.routes');
const adminDashboardRoutes = require('./modules/admin/dashboard/dashboard.routes');
const adminEmailLogRoutes = require('./modules/admin/emailLogs/emailLog.routes');
const adminEnrollmentRoutes = require('./modules/admin/adminEnrollments/adminEnrollment.routes');
const adminEmployeeRoutes = require('./modules/admin/employees/employee.routes');
const employeeLeadRoutes = require('./modules/employee/leads/employeeLead.routes');
const employeeDashboardRoutes = require('./modules/employee/dashboard/employeeDashboard.routes');
const adminPaymentRoutes = require('./modules/admin/adminPayments/adminPayment.routes');
const adminFollowupsReportRoutes = require('./modules/admin/adminFollowupsReport/adminFollowupsReport.routes');
const courseRoutes = require('./modules/courses/course.routes');
const educationMasterRoutes = require('./modules/educationMaster/educationMaster.routes');
const durationMasterRoutes = require('./modules/durationMaster/durationMaster.routes');
const promoCodeRoutes = require('./modules/promoCodes/promoCode.routes');
const webhookAdminRoutes = require('./modules/webhooks/webhook.routes');
const plansPublicRoutes = require('./modules/plans/plan.public.routes');
const plansAdminRoutes = require('./modules/plans/plan.admin.routes');
const adminEnrollmentManualRoutes = require('./modules/adminEnrollments/adminEnrollment.routes');
const internalPlansRoutes = require('./modules/internalPlans/internalPlan.routes');
const courseNameRoutes = require('./modules/courseNameMaster/courseName.routes');
const siteSettingsRoutes = require('./modules/siteSettings/siteSettings.routes');

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);

// Helmet, with crossOriginResourcePolicy disabled — the default `same-origin`
// value can confuse browsers that have a cached cross-origin response.
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }),
);

// CORS open to all origins. The cors middleware reflects the request's Origin
// header in Access-Control-Allow-Origin, which is required when
// credentials: true (the wildcard '*' is not allowed alongside credentials).
const corsOptions = {
  origin: (origin, cb) => cb(null, true),
  credentials: true,
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Requested-With', 'Idempotency-Key'],
  exposedHeaders: ['X-Trace-Id', 'RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset'],
  optionsSuccessStatus: 204,
  maxAge: 0,
};

// Tell browsers NEVER to cache the preflight response. `Access-Control-Max-Age: 0`
// alone is not always honoured by Chrome (it has a minimum cache time even at 0),
// so we also set Cache-Control: no-store on OPTIONS responses. Set this BEFORE
// the cors middleware so the headers are present when cors ends the OPTIONS request.
app.use((req, res, next) => {
  if (req.method === 'OPTIONS') {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Vary', 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers');
  }
  next();
});

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

app.use(compression());
app.use(requestLogger);

// Static serving for uploaded assets (e.g. the branding logo). Public, no auth.
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// Health endpoints — never rate-limited, never authenticated
app.get('/health', (_req, res) => {
  res.status(HTTP.OK).json({ status: 'ok', uptime: process.uptime() });
});

app.get('/ready', async (_req, res) => {
  try {
    await getPrismaClient().$queryRaw`SELECT 1`;
    res.status(HTTP.OK).json({ status: 'ready' });
  } catch (err) {
    res.status(HTTP.SERVICE_UNAVAILABLE).json({ status: 'unready', error: err.message });
  }
});

// Webhook route — raw body required for HMAC, mounted BEFORE express.json().
// Webhook is signature-gated, so no global rate limit applies here.
app.post('/api/v1/webhooks/razorpay', webhookRaw, webhookController.handle);

// JSON parser for the rest of the API
app.use(express.json({ limit: '1mb' }));
app.use(globalLimiter);

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/enrollments', enrollmentRoutes);
app.use('/api/v1/payments', paymentRoutes);
app.use('/api/v1/followups', followupRoutes);
app.use('/api/v1/admin/users', adminUserRoutes);
app.use('/api/v1/admin/razorpay-configs', adminRazorpayConfigRoutes);
app.use('/api/v1/admin/external-api-logs', adminExternalApiLogRoutes);
app.use('/api/v1/audit-logs', auditRoutes);
app.use('/api/v1/reports', reportsRoutes);
app.use('/api/v1/admin/dashboard', adminDashboardRoutes);
app.use('/api/v1/admin/email-logs', adminEmailLogRoutes);
// Admin enrollment manual + bulk routes (new F1 module) — mounted BEFORE the list route
// so /manual, /bulk, /csv-template are resolved first.
app.use('/api/v1/admin/enrollments', adminEnrollmentManualRoutes);
// Admin enrollment list (existing Phase 3B module)
app.use('/api/v1/admin/enrollments', adminEnrollmentRoutes);
// Admin employees list — minimal projection for the assignment dropdown.
// Sits alongside (not under) /admin/users so user-management CRUD is
// untouched. Permission gate: LEADS_ASSIGN.
app.use('/api/v1/admin/employees', adminEmployeeRoutes);
// Employee Follow-Up Portal — read + act on leads assigned to the caller.
// Permission gate: LEADS_VIEW_OWN. Per-row ownership enforced inside the
// service so admins can hit the same endpoint for monitoring.
app.use('/api/v1/employee/leads', employeeLeadRoutes);
// Employee dashboard tiles + recent activity. Same gate; counts are
// hard-bound to req.user.id server-side.
app.use('/api/v1/employee/dashboard', employeeDashboardRoutes);
app.use('/api/v1/admin/payments', adminPaymentRoutes);
app.use('/api/v1/admin/follow-ups/report', adminFollowupsReportRoutes);
// Frontend hits /follow-ups (hyphenated) for the admin Follow-ups page list view
// — alias to the same camelCase report listing.
app.use('/api/v1/follow-ups', adminFollowupsReportRoutes);
app.use('/api/v1/courses', courseRoutes);
app.use('/api/v1/education-master', educationMasterRoutes);
app.use('/api/v1/duration-master', durationMasterRoutes);
app.use('/api/v1/promo-codes', promoCodeRoutes);
// Plans — public catalog and admin CRUD
app.use('/api/v1/plans', plansPublicRoutes);
app.use('/api/v1/admin/plans', plansAdminRoutes);
// Admin webhook delivery history — mounted AFTER the raw Razorpay handler above
// so /api/v1/webhooks/razorpay (app.post, line ~80) is not shadowed by this router.
app.use('/api/v1/webhooks', webhookAdminRoutes);
// Internal Plans admin CRUD + coupon/fee utilities
app.use('/api/v1/admin/internal-plans', internalPlansRoutes);
// Course Name Master CRUD
app.use('/api/v1/admin/course-names', courseNameRoutes);
app.use('/api/v1/settings', siteSettingsRoutes);

app.use((req, res) => {
  return sendError(
    res,
    HTTP.NOT_FOUND,
    ERROR_CODES.NOT_FOUND,
    `Route not found: ${req.method} ${req.originalUrl}`,
    req.traceId,
  );
});

app.use(errorHandler);

module.exports = app;
