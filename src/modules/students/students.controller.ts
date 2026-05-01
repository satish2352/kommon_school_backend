import { Request, Response } from 'express';
import { asyncHandler } from '@/utils/asyncHandler';
import { ApiResponse } from '@/utils/ApiResponse';
import { ApiError } from '@/utils/ApiError';
import { studentsService } from './students.service';
import type { CreateStudentInput, UpdateStudentInput, ListStudentsQuery } from './students.schema';

export const listStudents = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.tenant?.id ?? req.user?.tenantId;
  if (!tenantId) {
    throw ApiError.badRequest('Tenant context required');
  }

  const result = await studentsService.listStudents(
    tenantId,
    req.query as unknown as ListStudentsQuery,
  );

  ApiResponse.paginated(res, result.items as object[], {
    page: result.page,
    limit: result.limit,
    total: result.total,
  });
});

export const getStudentById = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.tenant?.id ?? req.user?.tenantId;
  if (!tenantId) {
    throw ApiError.badRequest('Tenant context required');
  }

  const student = await studentsService.getStudentById(req.params['id']!, tenantId);
  ApiResponse.success(res, student);
});

export const createStudent = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.tenant?.id ?? req.user?.tenantId;
  if (!tenantId) {
    throw ApiError.badRequest('Tenant context required');
  }

  const student = await studentsService.createStudent(req.body as CreateStudentInput, tenantId);
  ApiResponse.created(res, student, 'Student created successfully');
});

export const updateStudent = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.tenant?.id ?? req.user?.tenantId;
  if (!tenantId) {
    throw ApiError.badRequest('Tenant context required');
  }

  const student = await studentsService.updateStudent(
    req.params['id']!,
    tenantId,
    req.body as UpdateStudentInput,
  );

  ApiResponse.success(res, student, 'Student updated successfully');
});

export const deleteStudent = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.tenant?.id ?? req.user?.tenantId;
  if (!tenantId) {
    throw ApiError.badRequest('Tenant context required');
  }

  await studentsService.deleteStudent(req.params['id']!, tenantId);
  ApiResponse.noContent(res);
});
