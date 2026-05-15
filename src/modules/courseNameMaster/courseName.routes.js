'use strict';

const { Router } = require('express');
const controller = require('./courseName.controller');
const { validate } = require('../../middleware/validate.middleware');
const { authenticate } = require('../../middleware/auth.middleware');
const { hasPermission } = require('../../middleware/rbac.middleware');
const {
  createCourseNameSchema,
  updateCourseNameSchema,
  listCourseNameQuerySchema,
  courseNameIdParamSchema,
} = require('./courseName.validator');
const { PERMISSIONS } = require('../../config/constants');

const router = Router();

// All course-names endpoints require authentication.
router.use(authenticate);

// GET /api/v1/admin/course-names — paginated, searchable list
router.get(
  '/',
  hasPermission(PERMISSIONS.COURSES_VIEW),
  validate(listCourseNameQuerySchema, 'query'),
  controller.list,
);

// GET /api/v1/admin/course-names/:id
router.get(
  '/:id',
  hasPermission(PERMISSIONS.COURSES_VIEW),
  validate(courseNameIdParamSchema, 'params'),
  controller.getById,
);

// POST /api/v1/admin/course-names
router.post(
  '/',
  hasPermission(PERMISSIONS.COURSES_MANAGE),
  validate(createCourseNameSchema),
  controller.create,
);

// PATCH /api/v1/admin/course-names/:id
router.patch(
  '/:id',
  hasPermission(PERMISSIONS.COURSES_MANAGE),
  validate(courseNameIdParamSchema, 'params'),
  validate(updateCourseNameSchema),
  controller.update,
);

// DELETE /api/v1/admin/course-names/:id
router.delete(
  '/:id',
  hasPermission(PERMISSIONS.COURSES_MANAGE),
  validate(courseNameIdParamSchema, 'params'),
  controller.remove,
);

module.exports = router;
