'use strict';

const { Router } = require('express');
const controller = require('./adminPayment.controller');
const { validate } = require('../../../middleware/validate.middleware');
const { authenticate } = require('../../../middleware/auth.middleware');
const { hasPermission } = require('../../../middleware/rbac.middleware');
const { listPaymentsQuerySchema, listFailedPaymentsQuerySchema } = require('./adminPayment.validator');
const { PERMISSIONS } = require('../../../config/constants');

const router = Router();

router.use(authenticate);
router.use(hasPermission(PERMISSIONS.PAYMENTS_VIEW));

// /failed must be declared before /:id-style routes to avoid prefix shadowing
router.get('/failed', validate(listFailedPaymentsQuerySchema, 'query'), controller.listFailed);
router.get('/',       validate(listPaymentsQuerySchema,       'query'), controller.list);

module.exports = router;
