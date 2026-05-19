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

// GET /api/v1/admin/enrollments/:id — single enrollment + plan + course
// + ALL payment rows. Powers the InternalEnrollments detail drawer.
// Declared AFTER the /manual /internal /bulk /csv-template routes on
// the sibling router (mounted earlier in app.use) so those don't match
// the :id pattern.
router.get('/:id', controller.getById);

module.exports = router;
