'use strict';

const { Router } = require('express');
const controller = require('./employeeDashboard.controller');
const { authenticate } = require('../../../middleware/auth.middleware');
const { hasPermission } = require('../../../middleware/rbac.middleware');
const { PERMISSIONS } = require('../../../config/constants');

const router = Router();

router.use(authenticate);
// Same gate as /employee/leads/* — anyone who can read their own leads
// can read their own dashboard. The service hard-binds the WHERE clause
// to req.user.id so admins hitting this route see their own (empty)
// dashboard, not a privileged cross-employee view.
router.use(hasPermission(PERMISSIONS.LEADS_VIEW_OWN));

router.get('/', controller.getDashboard);

module.exports = router;
