'use strict';

const { Router } = require('express');
const controller = require('./durationMaster.controller');
const { validate } = require('../../middleware/validate.middleware');
const { authenticate } = require('../../middleware/auth.middleware');
const { hasPermission } = require('../../middleware/rbac.middleware');
const {
  createDurationMasterSchema,
  updateDurationMasterSchema,
  listDurationMasterQuerySchema,
  durationMasterIdParamSchema,
} = require('./durationMaster.validator');
const { PERMISSIONS } = require('../../config/constants');

const router = Router();

// All duration-master endpoints require authentication.
router.use(authenticate);

// GET /api/v1/duration-master — paginated, searchable list
router.get(
  '/',
  hasPermission(PERMISSIONS.DURATION_MASTER_VIEW),
  validate(listDurationMasterQuerySchema, 'query'),
  controller.list,
);

// GET /api/v1/duration-master/:id
router.get(
  '/:id',
  hasPermission(PERMISSIONS.DURATION_MASTER_VIEW),
  validate(durationMasterIdParamSchema, 'params'),
  controller.getById,
);

// POST /api/v1/duration-master
router.post(
  '/',
  hasPermission(PERMISSIONS.DURATION_MASTER_MANAGE),
  validate(createDurationMasterSchema),
  controller.create,
);

// PATCH /api/v1/duration-master/:id
router.patch(
  '/:id',
  hasPermission(PERMISSIONS.DURATION_MASTER_MANAGE),
  validate(durationMasterIdParamSchema, 'params'),
  validate(updateDurationMasterSchema),
  controller.update,
);

// DELETE /api/v1/duration-master/:id
router.delete(
  '/:id',
  hasPermission(PERMISSIONS.DURATION_MASTER_MANAGE),
  validate(durationMasterIdParamSchema, 'params'),
  controller.remove,
);

module.exports = router;
