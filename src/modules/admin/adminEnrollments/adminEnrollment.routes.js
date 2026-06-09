'use strict';

const { Router } = require('express');
const controller = require('./adminEnrollment.controller');
const { validate } = require('../../../middleware/validate.middleware');
const { authenticate } = require('../../../middleware/auth.middleware');
const { hasPermission } = require('../../../middleware/rbac.middleware');
const { listEnrollmentsQuerySchema } = require('./adminEnrollment.validator');
const { PERMISSIONS } = require('../../../config/constants');

const router = Router();

router.use(authenticate);
router.use(hasPermission(PERMISSIONS.ENROLLMENTS_VIEW));

router.get('/', validate(listEnrollmentsQuerySchema, 'query'), controller.list);

// GET /api/v1/admin/enrollments/grouped — one row per email (latest + count)
// across all enrollments, with the same filters as the flat list. BEFORE /:id.
router.get('/grouped', controller.groupedByEmail);

// GET /api/v1/admin/enrollments/internal-grouped — one row per email (latest +
// count) for internal enrollments. Declared BEFORE /:id.
router.get('/internal-grouped', controller.internalGrouped);

// GET /api/v1/admin/enrollments/by-email?email=... — all enrollments sharing an
// email (grouped history). Declared BEFORE the /:id route so "by-email" is not
// captured as an enrollment id.
router.get('/by-email', controller.historyByEmail);

// GET /api/v1/admin/enrollments/:id — single enrollment + plan + course
// + ALL payment rows. Powers the InternalEnrollments detail drawer.
// Declared AFTER the /manual /internal /bulk /csv-template routes on
// the sibling router (mounted earlier in app.use) so those don't match
// the :id pattern.
router.get('/:id', controller.getById);

// POST /api/v1/admin/enrollments/:id/retry-sync — re-queue the external-API
// sync job for an enrollment whose external_sync_status is FAILED or
// DEAD_LETTER. Standard SaaS recovery action — admin clicks "Retry sync"
// after the root cause (dead webhook URL, expired token, etc.) is fixed.
router.post('/:id/retry-sync', controller.retrySync);

module.exports = router;
