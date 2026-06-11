'use strict';

const { Router } = require('express');
const controller = require('./contact.controller');
const { validate } = require('../../middleware/validate.middleware');
const { authenticate } = require('../../middleware/auth.middleware');
const { hasPermission } = require('../../middleware/rbac.middleware');
const { listContactQuerySchema, idParamSchema, updateStatusSchema } = require('./contact.validator');
const { PERMISSIONS } = require('../../config/constants');

const router = Router();

router.use(authenticate);

// GET /api/v1/admin/contact-messages — paginated, searchable list.
router.get(
  '/',
  hasPermission(PERMISSIONS.FOLLOWUPS_VIEW),
  validate(listContactQuerySchema, 'query'),
  controller.list,
);

// PATCH /api/v1/admin/contact-messages/:id/status — update lifecycle status.
router.patch(
  '/:id/status',
  hasPermission(PERMISSIONS.FOLLOWUPS_MANAGE),
  validate(idParamSchema, 'params'),
  validate(updateStatusSchema),
  controller.updateStatus,
);

module.exports = router;
