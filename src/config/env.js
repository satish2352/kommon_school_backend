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

  // Integration API — single source of truth for the Kommon School / Sumago
  // platform integration. EXTERNAL_API_URL is the BASE url; the code derives
  // <base>/integrations/provision-user (POST, enrollment sync) and
  // <base>/integrations/get-users (GET, admin proxy) from it. EXTERNAL_API_TOKEN
  // is the Bearer token for both. (Formerly split across SUMAGO_API_BASE_URL /
  // SUMAGO_API_TOKEN, now consolidated.)
  EXTERNAL_API_URL: Joi.string().uri().required(),
  EXTERNAL_API_TOKEN: Joi.string().required(),
  EXTERNAL_API_TIMEOUT_MS: Joi.number().integer().min(1000).default(15000),

  CORS_ALLOWED_ORIGINS: Joi.string().default('http://localhost:3000'),

  // ---------------------------------------------------------------------------
  // EMAIL / SMTP — onboarding email sent to newly enrolled students.
  // MAIL_ENABLED gates the whole feature so dev environments without SMTP
  // credentials still boot and enroll (the send is skipped + logged, never
  // throws). When enabled, SMTP_HOST/PORT/USER/PASS + MAIL_FROM are required.
  // ---------------------------------------------------------------------------
  MAIL_ENABLED: Joi.boolean().truthy('true', '1').falsy('false', '0').default(false),
  SMTP_HOST: Joi.string().when('MAIL_ENABLED', { is: true, then: Joi.required(), otherwise: Joi.optional().allow('') }),
  SMTP_PORT: Joi.number().integer().min(1).max(65535).default(465),
  // SMTP_SECURE=true → implicit TLS (port 465). false → STARTTLS (port 587).
  SMTP_SECURE: Joi.boolean().truthy('true', '1').falsy('false', '0').default(true),
  SMTP_USER: Joi.string().when('MAIL_ENABLED', { is: true, then: Joi.required(), otherwise: Joi.optional().allow('') }),
  SMTP_PASS: Joi.string().when('MAIL_ENABLED', { is: true, then: Joi.required(), otherwise: Joi.optional().allow('') }),
  // From header. Falls back to SMTP_USER when blank. Supports "Name <addr>" form.
  MAIL_FROM: Joi.string().optional().allow(''),
  // Public login URL embedded in the onboarding email + the page the student
  // signs in on. Must match the deployed frontend origin.
  FRONTEND_LOGIN_URL: Joi.string().uri().default('http://localhost:5173/login'),

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
