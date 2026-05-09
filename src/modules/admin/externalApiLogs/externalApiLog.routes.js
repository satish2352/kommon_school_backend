'use strict';

const { Router } = require('express');
const controller = require('./externalApiLog.controller');
const { validate } = require('../../../middleware/validate.middleware');
const { authenticate } = require('../../../middleware/auth.middleware');
const { hasPermission } = require('../../../middleware/rbac.middleware');
const { listQuerySchema, idParamSchema } = require('./externalApiLog.validator');
const { PERMISSIONS } = require('../../../config/constants');

const router = Router();

router.use(authenticate);
router.use(hasPermission(PERMISSIONS.EXTERNAL_API_LOGS_VIEW));

router.get('/', validate(listQuerySchema, 'query'), controller.list);
router.get('/:id', validate(idParamSchema, 'params'), controller.getById);

module.exports = router;
