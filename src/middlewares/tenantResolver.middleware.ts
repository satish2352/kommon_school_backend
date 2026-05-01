import { Request, Response, NextFunction } from 'express';
import { TenantStatus } from '@prisma/client';
import { asyncHandler } from '@/utils/asyncHandler';
import { ApiError } from '@/utils/ApiError';
import { prisma } from '@/config/database';
import { cacheGetOrSet, buildCacheKey } from '@/utils/cache';
import { env } from '@/config/env';
import { logger } from '@/config/logger';

/**
 * Resolves the current tenant from either:
 *   - X-Tenant-Id header (UUID or slug)
 *   - Subdomain (e.g. greenwood-high.kommon.school)
 *
 * Attaches tenant info to req.tenant.
 * Does NOT throw if no tenant is found — some routes (super_admin, health)
 * don't require a tenant. Route-level middleware enforces tenant presence.
 */
export const tenantResolverMiddleware = asyncHandler(
  async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const strategy = env.TENANT_RESOLUTION_STRATEGY;
    let tenantIdentifier: string | null = null;

    if (strategy === 'header') {
      tenantIdentifier = req.headers[env.TENANT_HEADER_NAME.toLowerCase()] as string ?? null;
    } else if (strategy === 'subdomain') {
      const host = req.hostname;
      // e.g. greenwood-high.kommon.school → greenwood-high
      const parts = host.split('.');
      if (parts.length >= 3) {
        tenantIdentifier = parts[0] ?? null;
      }
    }

    if (!tenantIdentifier) {
      // No tenant context — routes that need it will enforce via requireTenant middleware
      return next();
    }

    const cacheKey = buildCacheKey('tenant', tenantIdentifier);

    const tenant = await cacheGetOrSet(
      cacheKey,
      () =>
        prisma.tenant.findFirst({
          where: {
            OR: [{ id: tenantIdentifier! }, { slug: tenantIdentifier! }],
            deletedAt: null,
          },
          select: {
            id: true,
            slug: true,
            name: true,
            status: true,
          },
        }),
      env.CACHE_TTL_TENANT,
    );

    if (!tenant) {
      logger.warn({ tenantIdentifier }, 'Unknown tenant identifier');
      throw ApiError.notFound('Tenant');
    }

    if (tenant.status === TenantStatus.SUSPENDED || tenant.status === TenantStatus.CANCELLED) {
      throw ApiError.forbidden(`Tenant account is ${tenant.status.toLowerCase()}`);
    }

    req.tenant = {
      id: tenant.id,
      slug: tenant.slug,
      name: tenant.name,
      status: tenant.status,
    };

    next();
  },
);

/**
 * Enforces that a tenant was resolved.
 * Use on routes that strictly require tenant context.
 */
export function requireTenant(req: Request, _res: Response, next: NextFunction): void {
  if (!req.tenant) {
    throw ApiError.badRequest(
      `Tenant context required — provide ${env.TENANT_HEADER_NAME} header`,
    );
  }
  next();
}
