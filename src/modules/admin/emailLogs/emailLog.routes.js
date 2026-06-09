'use strict';

const { Router } = require('express');
const controller = require('./emailLog.controller');
const { validate } = require('../../../middleware/validate.middleware');
const { authenticate } = require('../../../middleware/auth.middleware');
const { hasPermission } = require('../../../middleware/rbac.middleware');
const { PERMISSIONS } = require('../../../config/constants');
const { listQuerySchema, resendSchema } = require('./emailLog.validator');

const router = Router();

// Gate on EMAIL_LOGS_MANAGE (granted to admin + superadmin) so staff can view
// the onboarding email log and resend student credentials. The resend service
// itself refuses any non-student account, so this can never reset staff/admin
// passwords. (Distinct from USERS_MANAGE, which stays superadmin-only.)
router.use(authenticate);
router.use(hasPermission(PERMISSIONS.EMAIL_LOGS_MANAGE));

router.get('/', validate(listQuerySchema, 'query'), controller.list);
router.post('/resend', validate(resendSchema, 'body'), controller.resend);

module.exports = router;
