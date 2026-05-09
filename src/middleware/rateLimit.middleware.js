'use strict';

const rateLimit = require('express-rate-limit');

/**
 * Global limiter: 100 requests per minute per IP.
 * Applied app-wide in app.js.
 */
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests, please try again later.',
    },
  },
  skip: (req) => req.path === '/health' || req.path === '/ready',
});

/**
 * Login limiter: 5 requests per minute per IP.
 * Applied on POST /api/v1/auth/login.
 */
const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many login attempts, please try again later.',
    },
  },
});

module.exports = { globalLimiter, loginLimiter };
