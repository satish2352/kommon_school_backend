'use strict';

const { Router } = require('express');
const controller = require('./plan.controller');
const { validate } = require('../../middleware/validate.middleware');
const { planIdParamSchema, listPlanQuerySchema } = require('./plan.validator');

const router = Router();

// GET /api/v1/plans — list all ACTIVE plans with ACTIVE pricings
router.get(
  '/',
  validate(listPlanQuerySchema, 'query'),
  controller.listPublic,
);

// GET /api/v1/plans/:id — single ACTIVE plan
router.get(
  '/:id',
  validate(planIdParamSchema, 'params'),
  controller.getPublicById,
);

module.exports = router;
