'use strict';

const { Router } = require('express');
const { authenticate } = require('../../middleware/auth.middleware');
const { hasPermission } = require('../../middleware/rbac.middleware');
const { validate } = require('../../middleware/validate.middleware');
const { dateRangeQuerySchema, exportQuerySchema } = require('./reports.validator');
const controller = require('./reports.controller');
const { PERMISSIONS } = require('../../config/constants');

const router = Router();

const reportsGuard = [authenticate, hasPermission(PERMISSIONS.REPORTS_VIEW)];

router.get(
  '/payments-summary',
  ...reportsGuard,
  validate(dateRangeQuerySchema, 'query'),
  controller.paymentsSummary,
);

router.get(
  '/enrollments-funnel',
  ...reportsGuard,
  validate(dateRangeQuerySchema, 'query'),
  controller.enrollmentsFunnel,
);

router.get(
  '/external-api-health',
  ...reportsGuard,
  validate(dateRangeQuerySchema, 'query'),
  controller.externalApiHealth,
);

router.get(
  '/export',
  ...reportsGuard,
  validate(exportQuerySchema, 'query'),
  controller.exportCsv,
);

module.exports = router;
