'use strict';

const Joi = require('joi');

/**
 * Body schema for POST /api/v1/promo-codes/validate
 *
 * code is trimmed and uppercased by Joi before passing to the service,
 * so the service always receives a normalised value.
 */
const validatePromoCodeSchema = Joi.object({
  code: Joi.string().trim().uppercase().min(2).max(50).required(),
});

module.exports = { validatePromoCodeSchema };
