'use strict';

const { Router } = require('express');
const controller = require('./dashboard.controller');
const { authenticate } = require('../../../middleware/auth.middleware');
const { hasPermission } = require('../../../middleware/rbac.middleware');
const { PERMISSIONS } = require('../../../config/constants');

const router = Router();

router.use(authenticate);
router.use(hasPermission(PERMISSIONS.REPORTS_VIEW));

router.get('/', controller.getSummary);

module.exports = router;
