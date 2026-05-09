'use strict';

const { Router } = require('express');
const controller = require('./payment.controller');
const { validate } = require('../../middleware/validate.middleware');
const { authenticate } = require('../../middleware/auth.middleware');
const { hasPermission } = require('../../middleware/rbac.middleware');
const { createOrderSchema, verifyPaymentSchema } = require('./payment.validator');
const { PERMISSIONS } = require('../../config/constants');

const router = Router();

// Public — student creates a Razorpay order against an existing enrollment
router.post('/create-order', validate(createOrderSchema), controller.createOrder);

// Public — student returns from Razorpay checkout, signature is verified server-side
router.post('/verify', validate(verifyPaymentSchema), controller.verify);

// Public — frontend resume after refresh (edge case #6)
router.get('/by-enrollment/:enrollmentId', controller.getByEnrollment);

// Authenticated — marketing/admin retries a payment by payment ID
router.post(
  '/:id/retry',
  authenticate,
  hasPermission(PERMISSIONS.PAYMENTS_RETRY),
  controller.retry,
);

module.exports = router;
