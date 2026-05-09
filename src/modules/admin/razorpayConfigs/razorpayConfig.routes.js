'use strict';

const { Router } = require('express');
const controller = require('./razorpayConfig.controller');
const { validate } = require('../../../middleware/validate.middleware');
const { authenticate } = require('../../../middleware/auth.middleware');
const { hasPermission } = require('../../../middleware/rbac.middleware');
const {
  createConfigSchema,
  idParamSchema,
  listConfigsQuerySchema,
} = require('./razorpayConfig.validator');
const { PERMISSIONS } = require('../../../config/constants');

const router = Router();

router.use(authenticate);
router.use(hasPermission(PERMISSIONS.RAZORPAY_CONFIGS_MANAGE));

router.post('/', validate(createConfigSchema, 'body'), controller.create);
router.get('/', validate(listConfigsQuerySchema, 'query'), controller.list);
router.get('/:id', validate(idParamSchema, 'params'), controller.getById);
router.patch('/:id/activate', validate(idParamSchema, 'params'), controller.activate);
router.delete('/:id', validate(idParamSchema, 'params'), controller.remove);

module.exports = router;
