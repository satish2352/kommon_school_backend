'use strict';

const Joi = require('joi');

const updateSettingsSchema = Joi.object({
  brandName: Joi.string().trim().min(1).max(150).required().messages({
    'string.empty': 'Brand name is required',
    'any.required': 'Brand name is required',
    'string.max':   'Brand name must be at most 150 characters',
  }),
}).options({ stripUnknown: true });

module.exports = { updateSettingsSchema };
