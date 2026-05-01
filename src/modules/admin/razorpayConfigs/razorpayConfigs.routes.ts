import { Router } from 'express';
import { authenticate, authorize } from '@/middlewares/auth.middleware';
import {
  createConfig,
  listConfigs,
  updateConfig,
  activateConfig,
  deleteConfig,
} from './razorpayConfigs.controller';

const router = Router();

// All RazorpayConfig management endpoints restricted to SUPER_ADMIN only
router.use(authenticate, authorize('SUPER_ADMIN'));

/**
 * POST   /api/v1/admin/razorpay-configs         — create new config
 * GET    /api/v1/admin/razorpay-configs         — list configs (masked secrets)
 * PATCH  /api/v1/admin/razorpay-configs/:id     — update fields
 * POST   /api/v1/admin/razorpay-configs/:id/activate — set as active
 * DELETE /api/v1/admin/razorpay-configs/:id     — soft delete
 */
router.post('/', ...createConfig);
router.get('/', listConfigs);
router.patch('/:id', ...updateConfig);
router.post('/:id/activate', activateConfig);
router.delete('/:id', deleteConfig);

export default router;
