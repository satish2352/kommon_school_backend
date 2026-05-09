'use strict';

const { Router } = require('express');
const controller = require('./educationMaster.controller');
const { validate } = require('../../middleware/validate.middleware');
const { authenticate } = require('../../middleware/auth.middleware');
const { hasPermission } = require('../../middleware/rbac.middleware');
const {
  createEducationMasterSchema,
  updateEducationMasterSchema,
  listEducationMasterQuerySchema,
  educationMasterIdParamSchema,
} = require('./educationMaster.validator');
const { PERMISSIONS } = require('../../config/constants');

const router = Router();

// All education-master endpoints require authentication.
router.use(authenticate);

// GET /api/v1/education-master — paginated, searchable list
router.get(
  '/',
  hasPermission(PERMISSIONS.EDUCATION_MASTER_VIEW),
  validate(listEducationMasterQuerySchema, 'query'),
  controller.list,
);

// GET /api/v1/education-master/:id
router.get(
  '/:id',
  hasPermission(PERMISSIONS.EDUCATION_MASTER_VIEW),
  validate(educationMasterIdParamSchema, 'params'),
  controller.getById,
);

// POST /api/v1/education-master
router.post(
  '/',
  hasPermission(PERMISSIONS.EDUCATION_MASTER_MANAGE),
  validate(createEducationMasterSchema),
  controller.create,
);

// PATCH /api/v1/education-master/:id
router.patch(
  '/:id',
  hasPermission(PERMISSIONS.EDUCATION_MASTER_MANAGE),
  validate(educationMasterIdParamSchema, 'params'),
  validate(updateEducationMasterSchema),
  controller.update,
);

// DELETE /api/v1/education-master/:id
router.delete(
  '/:id',
  hasPermission(PERMISSIONS.EDUCATION_MASTER_MANAGE),
  validate(educationMasterIdParamSchema, 'params'),
  controller.remove,
);

module.exports = router;
