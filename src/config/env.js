'use strict';

const Joi = require('joi');

const envSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().integer().min(1).max(65535).default(3000),

  DATABASE_URL: Joi.string().uri().required(),

  JWT_ACCESS_SECRET: Joi.string().min(32).when('JWT_ALGORITHM', {
    is: 'HS256',
    then: Joi.required(),
    otherwise: Joi.optional().allow(''),
  }),
  JWT_ACCESS_EXPIRES_IN: Joi.string().default('15m'),
  JWT_REFRESH_SECRET: Joi.string().min(32).when('JWT_ALGORITHM', {
    is: 'HS256',
    then: Joi.required(),
    otherwise: Joi.optional().allow(''),
  }),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('7d'),

  // JWT algorithm selection — RS256 is production-recommended
  JWT_ALGORITHM: Joi.string().valid('HS256', 'RS256').default('HS256'),

  // RS256 key file paths — required when JWT_ALGORITHM=RS256
  JWT_ACCESS_PRIVATE_KEY_PATH: Joi.string().allow('').optional(),
  JWT_ACCESS_PUBLIC_KEY_PATH: Joi.string().allow('').optional(),
  JWT_REFRESH_PRIVATE_KEY_PATH: Joi.string().allow('').optional(),
  JWT_REFRESH_PUBLIC_KEY_PATH: Joi.string().allow('').optional(),

  RAZORPAY_KEY_ID: Joi.string().required(),
  RAZORPAY_KEY_SECRET: Joi.string().required(),
  RAZORPAY_WEBHOOK_SECRET: Joi.string().required(),
  ENCRYPTION_MASTER_KEY: Joi.string().hex().length(64).required(),

  REDIS_URL: Joi.string().uri().required(),

  EXTERNAL_API_URL: Joi.string().uri().required(),
  EXTERNAL_API_TOKEN: Joi.string().required(),
  EXTERNAL_API_TIMEOUT_MS: Joi.number().integer().min(1000).default(15000),

  // Sumago Platform Integration API — when set, the enrollment webhook fires
  // to <SUMAGO_API_BASE_URL>/integrations/provision-user with a Bearer token
  // and the admin /webhooks/sumago-users proxy becomes available.
  // Both are optional so dev environments without Sumago credentials still boot.
  SUMAGO_API_BASE_URL: Joi.string().uri().optional().allow(''),
  SUMAGO_API_TOKEN:    Joi.string().optional().allow(''),
  // Fixed taxonomy values sent in every webhook payload. Case-sensitive —
  // Sumago expects these exact strings. Defaults match the current Sumago config.
  SUMAGO_PLAN_CODE: Joi.string().optional().default('NOVA2025_30'),
  SUMAGO_GROUP:     Joi.string().optional().default('Engineering - UG'),
  SUMAGO_UNIT:      Joi.string().optional().default('B.Tech CSE'),
  SUMAGO_PHASE:     Joi.string().optional().default('Semester 1'),
  SUMAGO_SEGMENT:   Joi.string().optional().default('A'),

  CORS_ALLOWED_ORIGINS: Joi.string().default('http://localhost:3000'),

  LOG_LEVEL: Joi.string().valid('error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly').default('info'),
  LOG_DIR: Joi.string().default('logs'),

  SEED_ADMIN_EMAIL: Joi.string().email().optional(),
  SEED_ADMIN_PASSWORD: Joi.string().min(8).optional(),
})
  .custom((obj, helpers) => {
    // Cross-field validation: RS256 requires all four key paths
    if (obj.JWT_ALGORITHM === 'RS256') {
      const missing = [
        'JWT_ACCESS_PRIVATE_KEY_PATH',
        'JWT_ACCESS_PUBLIC_KEY_PATH',
        'JWT_REFRESH_PRIVATE_KEY_PATH',
        'JWT_REFRESH_PUBLIC_KEY_PATH',
      ].filter((k) => !obj[k]);

      if (missing.length > 0) {
        return helpers.error('any.invalid', {
          message: `JWT_ALGORITHM=RS256 requires these env vars to be set: ${missing.join(', ')}`,
        });
      }
    }
    return obj;
  })
  .unknown(true);

const { error, value } = envSchema.validate(process.env, {
  abortEarly: false,
  stripUnknown: true,
});

if (error) {
  const details = error.details.map((d) => d.message).join('\n  ');
  throw new Error(`Environment validation failed:\n  ${details}`);
}

module.exports = value;
