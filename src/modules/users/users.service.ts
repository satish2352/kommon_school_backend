import { UserRole, Prisma } from '@prisma/client';
import { prisma } from '@/config/database';
import { ApiError } from '@/utils/ApiError';
import { cacheDelete, buildCacheKey } from '@/utils/cache';
import { parsePagination } from '@/utils/ApiResponse';
import type { PaginatedResult } from '@/utils/ApiResponse';
import type { UpdateUserInput, ListUsersQuery } from './users.schema';

const userSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  phone: true,
  avatarUrl: true,
  isEmailVerified: true,
  isActive: true,
  lastLoginAt: true,
  tenantId: true,
  createdAt: true,
  updatedAt: true,
} as const;

type UserSummary = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  phone: string | null;
  avatarUrl: string | null;
  isEmailVerified: boolean;
  isActive: boolean;
  lastLoginAt: Date | null;
  tenantId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export class UsersService {
  async listUsers(
    tenantId: string | null,
    query: ListUsersQuery,
    callerRole: UserRole,
  ): Promise<PaginatedResult<UserSummary>> {
    const { page, limit, skip } = parsePagination(query.page, query.limit);

    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      // Super admin can see all users; tenant users only see their tenant
      ...(callerRole !== UserRole.SUPER_ADMIN ? { tenantId } : {}),
      ...(query.role ? { role: query.role as UserRole } : {}),
      ...(query.isActive !== undefined ? { isActive: query.isActive === 'true' } : {}),
      ...(query.search
        ? {
            OR: [
              { firstName: { contains: query.search, mode: 'insensitive' } },
              { lastName: { contains: query.search, mode: 'insensitive' } },
              { email: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.user.findMany({ where, select: userSelect, skip, take: limit, orderBy: { createdAt: 'desc' } }),
      prisma.user.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  async getUserById(id: string, tenantId: string | null, callerRole: UserRole): Promise<UserSummary> {
    const where: Prisma.UserWhereInput = {
      id,
      deletedAt: null,
      ...(callerRole !== UserRole.SUPER_ADMIN ? { tenantId } : {}),
    };

    const user = await prisma.user.findFirst({ where, select: userSelect });
    if (!user) {
      throw ApiError.notFound('User');
    }
    return user;
  }

  async updateUser(
    id: string,
    input: UpdateUserInput,
    tenantId: string | null,
    callerRole: UserRole,
  ): Promise<UserSummary> {
    // Verify user exists and belongs to correct tenant
    await this.getUserById(id, tenantId, callerRole);

    const updated = await prisma.user.update({
      where: { id },
      data: {
        ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
        ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl } : {}),
      },
      select: userSelect,
    });

    await cacheDelete(buildCacheKey('user', id));

    return updated;
  }

  async deactivateUser(
    id: string,
    tenantId: string | null,
    callerRole: UserRole,
  ): Promise<void> {
    await this.getUserById(id, tenantId, callerRole);

    await prisma.user.update({
      where: { id },
      data: { isActive: false },
    });

    await cacheDelete(buildCacheKey('user', id));
  }

  async deleteUser(
    id: string,
    tenantId: string | null,
    callerRole: UserRole,
  ): Promise<void> {
    await this.getUserById(id, tenantId, callerRole);

    // Soft delete
    await prisma.user.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });

    await cacheDelete(buildCacheKey('user', id));
  }
}

export const usersService = new UsersService();
