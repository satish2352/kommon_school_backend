'use strict';

const { Router } = require('express');
const controller = require('./course.controller');
const { validate } = require('../../middleware/validate.middleware');
const { authenticate } = require('../../middleware/auth.middleware');
const { hasPermission } = require('../../middleware/rbac.middleware');
const {
  createCourseSchema,
  updateCourseSchema,
  listCourseQuerySchema,
  courseIdParamSchema,
} = require('./course.validator');
const { PERMISSIONS } = require('../../config/constants');

const router = Router();

// ---------------------------------------------------------------------------
// All course endpoints require authentication.
// Apply authenticate middleware globally for this router.
// ---------------------------------------------------------------------------
router.use(authenticate);

// GET /api/v1/courses — paginated, searchable list
router.get(
  '/',
  hasPermission(PERMISSIONS.COURSES_VIEW),
  validate(listCourseQuerySchema, 'query'),
  controller.list,
);

// GET /api/v1/courses/:id — single course by integer PK
router.get(
  '/:id',
  hasPermission(PERMISSIONS.COURSES_VIEW),
  validate(courseIdParamSchema, 'params'),
  controller.getById,
);

// POST /api/v1/courses — create a new course
router.post(
  '/',
  hasPermission(PERMISSIONS.COURSES_MANAGE),
  validate(createCourseSchema),
  controller.create,
);

// PATCH /api/v1/courses/:id — partial update (including status toggle)
router.patch(
  '/:id',
  hasPermission(PERMISSIONS.COURSES_MANAGE),
  validate(courseIdParamSchema, 'params'),
  validate(updateCourseSchema),
  controller.update,
);

// DELETE /api/v1/courses/:id — hard delete
router.delete(
  '/:id',
  hasPermission(PERMISSIONS.COURSES_MANAGE),
  validate(courseIdParamSchema, 'params'),
  controller.remove,
);

module.exports = router;
