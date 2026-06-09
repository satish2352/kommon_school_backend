'use strict';

const { Router } = require('express');
const controller = require('./employee.controller');
const { validate } = require('../../../middleware/validate.middleware');
const { authenticate } = require('../../../middleware/auth.middleware');
const { hasPermission } = require('../../../middleware/rbac.middleware');
const { listEmployeesQuerySchema } = require('./employee.validator');
const { PERMISSIONS } = require('../../../config/constants');

const router = Router();

router.use(authenticate);
// LEADS_ASSIGN is the right gate here — anyone who can assign leads needs
// the employee dropdown. Superadmin bypasses the check globally.
router.use(hasPermission(PERMISSIONS.LEADS_ASSIGN));

router.get('/', validate(listEmployeesQuerySchema, 'query'), controller.list);

module.exports = router;
