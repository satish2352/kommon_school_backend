import { Router } from 'express';
import { authenticate, authorize } from '@/middlewares/auth.middleware';
import { validate } from '@/middlewares/validate.middleware';
import {
  listStudents,
  getStudentById,
  createStudent,
  updateStudent,
  deleteStudent,
} from './students.controller';
import {
  createStudentSchema,
  updateStudentSchema,
  listStudentsQuerySchema,
  studentIdParamSchema,
} from './students.schema';

const router = Router();

router.use(authenticate);

router.get(
  '/',
  authorize('SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER'),
  validate({ query: listStudentsQuerySchema.shape.query }),
  listStudents,
);

router.get(
  '/:id',
  validate({ params: studentIdParamSchema.shape.params }),
  getStudentById,
);

router.post(
  '/',
  authorize('SUPER_ADMIN', 'SCHOOL_ADMIN'),
  validate({ body: createStudentSchema.shape.body }),
  createStudent,
);

router.patch(
  '/:id',
  authorize('SUPER_ADMIN', 'SCHOOL_ADMIN'),
  validate({ params: studentIdParamSchema.shape.params, body: updateStudentSchema.shape.body }),
  updateStudent,
);

router.delete(
  '/:id',
  authorize('SUPER_ADMIN', 'SCHOOL_ADMIN'),
  validate({ params: studentIdParamSchema.shape.params }),
  deleteStudent,
);

export default router;
