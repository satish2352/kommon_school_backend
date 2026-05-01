import { Request, Response } from 'express';
import { UserRole } from '@prisma/client';
import { asyncHandler } from '@/utils/asyncHandler';
import { ApiResponse } from '@/utils/ApiResponse';
import { ApiError } from '@/utils/ApiError';
import { usersService } from './users.service';
import type { UpdateUserInput, ListUsersQuery } from './users.schema';

export const listUsers = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.user?.tenantId ?? null;
  const callerRole = req.user!.role as UserRole;

  const result = await usersService.listUsers(tenantId, req.query as unknown as ListUsersQuery, callerRole);

  ApiResponse.paginated(res, result.items, {
    page: result.page,
    limit: result.limit,
    total: result.total,
  });
});

export const getUserById = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.user?.tenantId ?? null;
  const callerRole = req.user!.role as UserRole;

  const user = await usersService.getUserById(req.params['id']!, tenantId, callerRole);

  ApiResponse.success(res, user);
});

export const updateUser = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.user?.tenantId ?? null;
  const callerRole = req.user!.role as UserRole;
  const targetId = req.params['id']!;

  // Users can only update their own profile unless they are admin
  if (
    callerRole !== UserRole.SUPER_ADMIN &&
    callerRole !== UserRole.SCHOOL_ADMIN &&
    req.user!.id !== targetId
  ) {
    throw ApiError.forbidden('You can only update your own profile');
  }

  const user = await usersService.updateUser(
    targetId,
    req.body as UpdateUserInput,
    tenantId,
    callerRole,
  );

  ApiResponse.success(res, user, 'User updated successfully');
});

export const deleteUser = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.user?.tenantId ?? null;
  const callerRole = req.user!.role as UserRole;

  await usersService.deleteUser(req.params['id']!, tenantId, callerRole);

  ApiResponse.noContent(res);
});
