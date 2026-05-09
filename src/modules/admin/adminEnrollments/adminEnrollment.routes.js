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

module.exports = router;
