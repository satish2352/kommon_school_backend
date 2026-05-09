'use strict';

const { Router } = require('express');
const controller = require('./adminFollowupsReport.controller');
const { validate } = require('../../../middleware/validate.middleware');
const { authenticate } = require('../../../middleware/auth.middleware');
const { hasPermission } = require('../../../middleware/rbac.middleware');
const { listFollowupsReportQuerySchema } = require('./adminFollowupsReport.validator');
const { PERMISSIONS } = require('../../../config/constants');

const router = Router();

router.use(authenticate);
router.use(hasPermission(PERMISSIONS.FOLLOWUPS_VIEW));

router.get('/', validate(listFollowupsReportQuerySchema, 'query'), controller.listReport);

module.exports = router;
