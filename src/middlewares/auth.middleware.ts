import { Request, Response, NextFunction } from 'express';
import { UserRole } from '@prisma/client';
import { verifyAccessToken } from '@/utils/jwt';
import { ApiError } from '@/utils/ApiError';
import { asyncHandler } from '@/utils/asyncHandler';
import { prisma } from '@/config/database';
import { cacheGetOrSet, buildCacheKey } from '@/utils/cache';
import { env } from '@/config/env';

/**
 * Verifies the Bearer access token and attaches user info to req.user.
 * Optionally checks that the user still exists and is active (with caching).
 */
export const authenticate = asyncHandler(async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    throw ApiError.unauthorized('Missing or malformed Authorization header');
  }

  const token = authHeader.slice(7);
  const payload = verifyAccessToken(token);

  // Cache user lookup to avoid hitting DB on every request
  const cacheKey = buildCacheKey('user', payload.sub);
  const user = await cacheGetOrSet(
    cacheKey,
    () =>
      prisma.user.findFirst({
        where: {
          id: payload.sub,
          deletedAt: null,
          isActive: true,
        },
        select: {
          id: true,
          email: true,
          role: true,
          tenantId: true,
          isActive: true,
          deletedAt: true,
        },
      }),
    env.CACHE_TTL_USER,
  );

  if (!user) {
    throw ApiError.unauthorized('User not found or inactive');
  }

  req.user = {
    id: user.id,
    email: user.email,
    role: user.role,
    tenantId: user.tenantId,
  };

  next();
});

/**
 * Role-based access control middleware factory.
 * Usage: authorize('SCHOOL_ADMIN', 'SUPER_ADMIN')
 */
export function authorize(...roles: UserRole[]) {
  return asyncHandler(async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      throw ApiError.unauthorized();
    }
    if (!roles.includes(req.user.role as UserRole)) {
      throw ApiError.forbidden(
        `This action requires one of: ${roles.join(', ')}. Your role: ${req.user.role}`,
      );
    }
    next();
  });
}

/**
 * Ensures the authenticated user belongs to the resolved tenant.
 * Super admins bypass this check.
 */
export const requireTenantMatch = asyncHandler(async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
  if (!req.user) {
    throw ApiError.unauthorized();
  }

  // Super admins can access any tenant
  if (req.user.role === UserRole.SUPER_ADMIN) {
    return next();
  }

  if (!req.tenant) {
    throw ApiError.badRequest('Tenant context required — provide X-Tenant-Id header');
  }

  if (req.user.tenantId !== req.tenant.id) {
    throw ApiError.forbidden('You do not have access to this tenant');
  }

  next();
});
