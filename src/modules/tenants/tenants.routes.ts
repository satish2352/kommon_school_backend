import { Router } from 'express';
import { authenticate, authorize } from '@/middlewares/auth.middleware';
import { validate } from '@/middlewares/validate.middleware';
import {
  listTenants,
  getTenantById,
  createTenant,
  updateTenant,
  deleteTenant,
} from './tenants.controller';
import {
  createTenantSchema,
  updateTenantSchema,
  listTenantsQuerySchema,
  tenantIdParamSchema,
} from './tenants.schema';

const router = Router();

// All tenant management is SUPER_ADMIN only
router.use(authenticate, authorize('SUPER_ADMIN'));

router.get('/', validate({ query: listTenantsQuerySchema.shape.query }), listTenants);
router.get('/:id', validate({ params: tenantIdParamSchema.shape.params }), getTenantById);
router.post('/', validate({ body: createTenantSchema.shape.body }), createTenant);
router.patch('/:id', validate({ params: tenantIdParamSchema.shape.params, body: updateTenantSchema.shape.body }), updateTenant);
router.delete('/:id', validate({ params: tenantIdParamSchema.shape.params }), deleteTenant);

export default router;
