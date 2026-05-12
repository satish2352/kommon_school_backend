'use strict';

const Joi = require('joi');

/**
 * Shared schema for a single manual enrollment row.
 * Used by both the manual endpoint and CSV bulk processing.
 */
const manualEnrollmentSchema = Joi.object({
  name: Joi.string().trim().min(2).max(200).required(),
  email: Joi.string().email().required(),
  phone: Joi.string().pattern(/^\d{10}$/).required().messages({
    'string.pattern.base': 'phone must be exactly 10 digits',
  }),
  role: Joi.string()
    .valid('STUDENT', 'FRESH_GRADUATE', 'WORKING_PROFESSIONAL', 'CAREER_SWITCHER')
    .required(),
  education: Joi.string()
    .valid('SCHOOL', 'JR_COLLEGE', 'UNDERGRADUATE', 'GRADUATE', 'POST_GRADUATE', 'DOCTORATE', 'OTHER')
    .optional()
    .allow(null, ''),
  readiness: Joi.string()
    .valid('BEGINNER', 'INTERMEDIATE', 'READY_FOR_INTERVIEW')
    .optional()
    .allow(null, ''),
  source: Joi.string()
    .valid('SOCIAL_MEDIA', 'COLLEGE', 'FRIEND', 'GOOGLE', 'OTHER')
    .optional()
    .allow(null, ''),
  promoCode: Joi.string().max(50).optional().allow(null, '').default('NEW501'),
  planTier: Joi.string().valid('SILVER', 'GOLD', 'PLATINUM').required(),
  durationMonths: Joi.number().valid(1, 3, 6, 12).required(),
  notes: Joi.string().max(500).optional().allow(null, ''),
}).options({ stripUnknown: true });

module.exports = { manualEnrollmentSchema };
