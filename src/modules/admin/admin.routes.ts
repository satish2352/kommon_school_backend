import { Router } from 'express';
import { authenticate, authorize } from '@/middlewares/auth.middleware';
import {
  listEnrollments,
  listPayments,
  listFailedPayments,
  listExternalApiLogs,
  getFollowUpReport,
  getDashboard,
} from './admin.controller';
import razorpayConfigsRoutes from './razorpayConfigs/razorpayConfigs.routes';

const router = Router();

// All admin routes require authentication + ADMIN or SUPER_ADMIN role.
// RazorpayConfig sub-routes apply their own SUPER_ADMIN check on top.
router.use(authenticate, authorize('ADMIN', 'SUPER_ADMIN'));

/**
 * GET /api/v1/admin/dashboard
 * GET /api/v1/admin/enrollments
 * GET /api/v1/admin/payments
 * GET /api/v1/admin/payments/failed
 * GET /api/v1/admin/external-api-logs
 * GET /api/v1/admin/follow-ups/report
 */
router.get('/dashboard', getDashboard);
router.get('/enrollments', listEnrollments);
router.get('/payments/failed', listFailedPayments);
router.get('/payments', listPayments);
router.get('/external-api-logs', listExternalApiLogs);
router.get('/follow-ups/report', getFollowUpReport);

// RazorpayConfig management (SUPER_ADMIN only — enforced in sub-router)
router.use('/razorpay-configs', razorpayConfigsRoutes);

export default router;
