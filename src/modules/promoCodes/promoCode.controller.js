'use strict';

const { validatePromoCode } = require('./promoCode.service');
const { sendSuccess } = require('../../utils/ApiResponse');
const asyncHandler = require('../../utils/asyncHandler');
const { HTTP } = require('../../config/constants');

/**
 * POST /api/v1/promo-codes/validate
 *
 * Public endpoint — no auth required.
 * Rate-limited (5 req/60s per IP) via loginLimiter applied in routes.
 *
 * Body (validated by Joi, code is already trimmed+uppercased):
 *   { code: string }
 *
 * Success: 200 { valid: true, course: { id, nameOfCourseAsGroup, coupon } }
 * Failure: 400 PROMO_CODE_INVALID
 */
const validateHandler = asyncHandler(async (req, res) => {
  const { code } = req.body;
  const result = await validatePromoCode(code, req.traceId);
  sendSuccess(res, HTTP.OK, result, 'Promo code is valid');
});

module.exports = { validateHandler };
