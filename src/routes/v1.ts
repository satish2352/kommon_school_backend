import { Router } from 'express';
import healthRoutes from '@/modules/health/health.routes';
import authRoutes from '@/modules/auth/auth.routes';
import usersRoutes from '@/modules/users/users.routes';
import tenantsRoutes from '@/modules/tenants/tenants.routes';
import studentsRoutes from '@/modules/students/students.routes';
import enrollmentsRoutes from '@/modules/enrollments/enrollments.routes';
import paymentsRoutes from '@/modules/payments/payments.routes';
import followupsRoutes from '@/modules/followups/followups.routes';
import adminRoutes from '@/modules/admin/admin.routes';

const router = Router();

/**
 * Mount all v1 routes.
 *
 * /api/v1/health        — Liveness + readiness probes
 * /api/v1/auth          — Authentication (register, login, refresh, logout)
 * /api/v1/users         — User management
 * /api/v1/tenants       — Tenant management (super_admin only)
 * /api/v1/students      — Student records
 * /api/v1/enrollments   — Enrollment / lead capture (public POST, admin GET)
 * /api/v1/payments      — Payment orders, verification, heartbeat, refunds
 * /api/v1/follow-ups    — CRM follow-up management
 * /api/v1/admin         — Admin dashboard, reports, config management
 */
router.use('/health', healthRoutes);
router.use('/auth', authRoutes);
router.use('/users', usersRoutes);
router.use('/tenants', tenantsRoutes);
router.use('/students', studentsRoutes);
router.use('/enrollments', enrollmentsRoutes);
router.use('/payments', paymentsRoutes);
router.use('/follow-ups', followupsRoutes);
router.use('/admin', adminRoutes);

export default router;
