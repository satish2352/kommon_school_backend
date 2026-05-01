import { Router } from 'express';
import { authenticate, authorize } from '@/middlewares/auth.middleware';
import { validate } from '@/middlewares/validate.middleware';
import { listUsers, getUserById, updateUser, deleteUser } from './users.controller';
import { updateUserSchema, listUsersQuerySchema, userIdParamSchema } from './users.schema';

const router = Router();

// All user routes require authentication
router.use(authenticate);

router.get(
  '/',
  authorize('SUPER_ADMIN', 'SCHOOL_ADMIN'),
  validate({ query: listUsersQuerySchema.shape.query }),
  listUsers,
);

router.get(
  '/:id',
  validate({ params: userIdParamSchema.shape.params }),
  getUserById,
);

router.patch(
  '/:id',
  validate({ params: userIdParamSchema.shape.params, body: updateUserSchema.shape.body }),
  updateUser,
);

router.delete(
  '/:id',
  authorize('SUPER_ADMIN', 'SCHOOL_ADMIN'),
  validate({ params: userIdParamSchema.shape.params }),
  deleteUser,
);

export default router;
