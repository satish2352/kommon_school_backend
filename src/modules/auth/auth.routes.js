'use strict';

const { Router } = require('express');
const controller = require('./auth.controller');
const { validate } = require('../../middleware/validate.middleware');
const { authenticate } = require('../../middleware/auth.middleware');
const { loginLimiter } = require('../../middleware/rateLimit.middleware');
const { loginSchema, refreshSchema, changePasswordSchema } = require('./auth.validator');

const router = Router();

router.post('/login', loginLimiter, validate(loginSchema), controller.login);
router.post('/refresh', validate(refreshSchema), controller.refresh);
router.post('/logout', authenticate, controller.logout);
router.get('/me', authenticate, controller.me);

// Phase 3A: change-password — requires a valid access token
router.post(
  '/change-password',
  authenticate,
  validate(changePasswordSchema),
  controller.changePassword,
);

module.exports = router;
