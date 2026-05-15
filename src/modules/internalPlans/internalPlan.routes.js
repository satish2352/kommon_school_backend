'use strict';

const { Router } = require('express');
const controller = require('./internalPlan.controller');
const { validate } = require('../../middleware/validate.middleware');
const { authenticate } = require('../../middleware/auth.middleware');
const { hasPermission } = require('../../middleware/rbac.middleware');
const {
  createInternalPlanSchema,
  updateInternalPlanSchema,
  setStatusSchema,
  listInternalPlanQuerySchema,
  idParamSchema,
  courseIdParamSchema,
  validateCouponSchema,
  calculateFeeSchema,
} = require('./internalPlan.validator');
const { PERMISSIONS } = require('../../config/constants');

const router = Router();

// All internal-plans endpoints require authentication.
router.use(authenticate);

// ---------------------------------------------------------------------------
// Static-path routes MUST be registered before /:id to avoid param shadowing
// ---------------------------------------------------------------------------

// GET /api/v1/admin/internal-plans/by-course/:courseId
router.get(
  '/by-course/:courseId',
  hasPermission(PERMISSIONS.INTERNAL_PLANS_VIEW),
  validate(courseIdParamSchema, 'params'),
  controller.listByCourse,
);

// POST /api/v1/admin/internal-plans/validate-coupon
router.post(
  '/validate-coupon',
  hasPermission(PERMISSIONS.INTERNAL_PLANS_VIEW),
  validate(validateCouponSchema),
  controller.validateCoupon,
);

// POST /api/v1/admin/internal-plans/calculate-fee
router.post(
  '/calculate-fee',
  hasPermission(PERMISSIONS.INTERNAL_PLANS_VIEW),
  validate(calculateFeeSchema),
  controller.calculateFee,
);

// ---------------------------------------------------------------------------
// Dynamic /:id routes
// ---------------------------------------------------------------------------

// GET /api/v1/admin/internal-plans — paginated list
router.get(
  '/',
  hasPermission(PERMISSIONS.INTERNAL_PLANS_VIEW),
  validate(listInternalPlanQuerySchema, 'query'),
  controller.list,
);

// GET /api/v1/admin/internal-plans/:id
router.get(
  '/:id',
  hasPermission(PERMISSIONS.INTERNAL_PLANS_VIEW),
  validate(idParamSchema, 'params'),
  controller.getById,
);

// POST /api/v1/admin/internal-plans — create
router.post(
  '/',
  hasPermission(PERMISSIONS.INTERNAL_PLANS_MANAGE),
  validate(createInternalPlanSchema),
  controller.create,
);

// PATCH /api/v1/admin/internal-plans/:id/status — BEFORE /:id patch
router.patch(
  '/:id/status',
  hasPermission(PERMISSIONS.INTERNAL_PLANS_MANAGE),
  validate(idParamSchema, 'params'),
  validate(setStatusSchema),
  controller.setStatus,
);

// PATCH /api/v1/admin/internal-plans/:id — partial update
router.patch(
  '/:id',
  hasPermission(PERMISSIONS.INTERNAL_PLANS_MANAGE),
  validate(idParamSchema, 'params'),
  validate(updateInternalPlanSchema),
  controller.update,
);

// DELETE /api/v1/admin/internal-plans/:id
router.delete(
  '/:id',
  hasPermission(PERMISSIONS.INTERNAL_PLANS_MANAGE),
  validate(idParamSchema, 'params'),
  controller.remove,
);

module.exports = router;
