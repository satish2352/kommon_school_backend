'use strict';

require('dotenv').config();
require('./config/env'); // validates env on boot

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
const adminEnrollmentRoutes = require('./modules/admin/adminEnrollments/adminEnrollment.routes');
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

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(helmet());

const corsOrigins = (process.env.CORS_ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // allow non-browser tools (curl, Postman)
      if (corsOrigins.includes(origin)) return cb(null, true);
      return cb(new Error('Not allowed by CORS'));
    },
    credentials: true,
  }),
);

app.use(compression());
app.use(requestLogger);

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
// Admin enrollment manual + bulk routes (new F1 module) — mounted BEFORE the list route
// so /manual, /bulk, /csv-template are resolved first.
app.use('/api/v1/admin/enrollments', adminEnrollmentManualRoutes);
// Admin enrollment list (existing Phase 3B module)
app.use('/api/v1/admin/enrollments', adminEnrollmentRoutes);
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
