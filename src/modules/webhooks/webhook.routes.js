'use strict';

const { Router } = require('express');
const controller = require('./webhook.controller');
const { validate } = require('../../middleware/validate.middleware');
const { authenticate } = require('../../middleware/auth.middleware');
const { hasPermission } = require('../../middleware/rbac.middleware');
const {
  listDeliveryQuerySchema,
  deliveryIdParamSchema,
  sendTestSchema,
} = require('./webhook.validator');
const { PERMISSIONS } = require('../../config/constants');

const router = Router();

// ---------------------------------------------------------------------------
// All webhook admin endpoints require authentication.
// ---------------------------------------------------------------------------
router.use(authenticate);

// GET /api/v1/webhooks/deliveries — paginated, filterable list
router.get(
  '/deliveries',
  hasPermission(PERMISSIONS.WEBHOOKS_VIEW),
  validate(listDeliveryQuerySchema, 'query'),
  controller.list,
);

// GET /api/v1/webhooks/deliveries/:id — single delivery by integer PK
router.get(
  '/deliveries/:id',
  hasPermission(PERMISSIONS.WEBHOOKS_VIEW),
  validate(deliveryIdParamSchema, 'params'),
  controller.getById,
);

// GET /api/v1/webhooks/stats — aggregation counts
router.get(
  '/stats',
  hasPermission(PERMISSIONS.WEBHOOKS_VIEW),
  controller.stats,
);

// POST /api/v1/webhooks/test — fire a test webhook from the admin panel
router.post(
  '/test',
  hasPermission(PERMISSIONS.WEBHOOKS_TEST),
  validate(sendTestSchema),
  controller.sendTest,
);

module.exports = router;
