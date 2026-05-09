'use strict';

const { Router } = require('express');
const controller = require('./promoCode.controller');
const { validate } = require('../../middleware/validate.middleware');
const { loginLimiter } = require('../../middleware/rateLimit.middleware');
const { validatePromoCodeSchema } = require('./promoCode.validator');

const router = Router();

// ---------------------------------------------------------------------------
// POST /api/v1/promo-codes/validate
//
// PUBLIC — no auth middleware.
// Rate-limited to 5 req/60s per IP (same as login) to block brute-force
// enumeration of the promo code namespace.
// ---------------------------------------------------------------------------
router.post(
  '/validate',
  loginLimiter,
  validate(validatePromoCodeSchema),
  controller.validateHandler,
);

module.exports = router;
