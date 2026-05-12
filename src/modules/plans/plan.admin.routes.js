'use strict';

const { Router } = require('express');
const controller = require('./plan.controller');
const { validate } = require('../../middleware/validate.middleware');
const { authenticate } = require('../../middleware/auth.middleware');
const { hasPermission } = require('../../middleware/rbac.middleware');
const {
  createPlanSchema,
  updatePlanSchema,
  setStatusSchema,
  upsertPricingSchema,
  listPlanQuerySchema,
  planIdParamSchema,
  planPricingParamSchema,
  planDurationParamSchema,
} = require('./plan.validator');
const { PERMISSIONS } = require('../../config/constants');

const router = Router();

// All admin plan routes require authentication
router.use(authenticate);

// GET /api/v1/admin/plans — paginated list
router.get(
  '/',
  hasPermission(PERMISSIONS.PLANS_READ),
  validate(listPlanQuerySchema, 'query'),
  controller.listAdmin,
);

// GET /api/v1/admin/plans/:id — single plan
router.get(
  '/:id',
  hasPermission(PERMISSIONS.PLANS_READ),
  validate(planIdParamSchema, 'params'),
  controller.getAdminById,
);

// POST /api/v1/admin/plans — create plan + optional pricings
router.post(
  '/',
  hasPermission(PERMISSIONS.PLANS_CREATE),
  validate(createPlanSchema),
  controller.create,
);

// PATCH /api/v1/admin/plans/:id/status — toggle status
// Must be registered BEFORE /:id to avoid param conflict
router.patch(
  '/:id/status',
  hasPermission(PERMISSIONS.PLANS_UPDATE),
  validate(planIdParamSchema, 'params'),
  validate(setStatusSchema),
  controller.setStatus,
);

// GET /api/v1/admin/plans/:id/enrollments — paginated enrollments
// Must be registered BEFORE /:id PATCH to avoid param conflict
router.get(
  '/:id/enrollments',
  hasPermission(PERMISSIONS.PLANS_ENROLLMENTS_READ),
  validate(planIdParamSchema, 'params'),
  controller.listEnrollments,
);

// PATCH /api/v1/admin/plans/:id — update plan metadata
router.patch(
  '/:id',
  hasPermission(PERMISSIONS.PLANS_UPDATE),
  validate(planIdParamSchema, 'params'),
  validate(updatePlanSchema),
  controller.update,
);

// DELETE /api/v1/admin/plans/:id — delete plan (blocked if referenced)
router.delete(
  '/:id',
  hasPermission(PERMISSIONS.PLANS_DELETE),
  validate(planIdParamSchema, 'params'),
  controller.remove,
);

// PUT /api/v1/admin/plans/:planId/pricing/:durationMonths — upsert single pricing
router.put(
  '/:planId/pricing/:durationMonths',
  hasPermission(PERMISSIONS.PLANS_UPDATE),
  validate(planDurationParamSchema, 'params'),
  validate(upsertPricingSchema),
  controller.upsertPricing,
);

// DELETE /api/v1/admin/plans/:planId/pricing/:pricingId — deactivate pricing
router.delete(
  '/:planId/pricing/:pricingId',
  hasPermission(PERMISSIONS.PLANS_DELETE),
  validate(planPricingParamSchema, 'params'),
  controller.deactivatePricing,
);

module.exports = router;
