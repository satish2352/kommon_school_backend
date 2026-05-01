import { Router } from 'express';
import { validate } from '@/middlewares/validate.middleware';
import { authenticate } from '@/middlewares/auth.middleware';
import { authRateLimiter } from '@/middlewares/rateLimiter.middleware';
import {
  register,
  login,
  refreshToken,
  logout,
  changePassword,
  getMe,
} from './auth.controller';
import {
  registerSchema,
  loginSchema,
  refreshTokenSchema,
  changePasswordSchema,
} from './auth.schema';

const router = Router();

// Public routes — auth rate limiter applied
router.post('/register', authRateLimiter, validate({ body: registerSchema.shape.body }), register);
router.post('/login', authRateLimiter, validate({ body: loginSchema.shape.body }), login);
router.post('/refresh', authRateLimiter, validate({ body: refreshTokenSchema.shape.body }), refreshToken);

// Protected routes
router.post('/logout', authenticate, logout);
router.post('/change-password', authenticate, validate({ body: changePasswordSchema.shape.body }), changePassword);
router.get('/me', authenticate, getMe);

export default router;
