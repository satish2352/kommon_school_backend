'use strict';

const { Router } = require('express');
const controller = require('./enrollment.controller');
const { validate } = require('../../middleware/validate.middleware');
const { authenticate } = require('../../middleware/auth.middleware');
const { hasPermission } = require('../../middleware/rbac.middleware');
const {
  createEnrollmentSchema,
  listEnrollmentQuerySchema,
  idParamSchema,
  verifyPaymentNestedSchema,
} = require('./enrollment.validator');
const { PERMISSIONS } = require('../../config/constants');

const router = Router();

// ---------------------------------------------------------------------------
// Public routes — no auth required
// ---------------------------------------------------------------------------

// Student submits enrollment form (legacy snake_case or new camelCase shape)
router.post('/', validate(createEnrollmentSchema), controller.create);

// Phase 3A: create a Razorpay order for an enrollment (public marketing flow)
router.post(
  '/:id/payment-order',
  validate(idParamSchema, 'params'),
  controller.createPaymentOrderForEnrollment,
);

// Phase 3A: verify a Razorpay payment (public marketing flow, camelCase body)
router.post(
  '/:id/payment-verify',
  validate(idParamSchema, 'params'),
  validate(verifyPaymentNestedSchema),
  controller.verifyPaymentForEnrollment,
);

// ---------------------------------------------------------------------------
// Protected routes — require enrollments:view permission
// ---------------------------------------------------------------------------

router.get(
  '/',
  authenticate,
  hasPermission(PERMISSIONS.ENROLLMENTS_VIEW),
  validate(listEnrollmentQuerySchema, 'query'),
  controller.list,
);

router.get(
  '/:id',
  authenticate,
  hasPermission(PERMISSIONS.ENROLLMENTS_VIEW),
  controller.getById,
);

module.exports = router;
