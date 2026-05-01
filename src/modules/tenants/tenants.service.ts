import { TenantStatus, Prisma } from '@prisma/client';
import { prisma } from '@/config/database';
import { ApiError } from '@/utils/ApiError';
import { cacheDelete, cacheDeletePattern, buildCacheKey } from '@/utils/cache';
import { parsePagination } from '@/utils/ApiResponse';
import type { PaginatedResult } from '@/utils/ApiResponse';
import type { CreateTenantInput, UpdateTenantInput, ListTenantsQuery } from './tenants.schema';

const tenantSelect = {
  id: true,
  name: true,
  slug: true,
  domain: true,
  status: true,
  logoUrl: true,
  address: true,
  phone: true,
  email: true,
  timezone: true,
  locale: true,
  settings: true,
  createdAt: true,
  updatedAt: true,
} as const;

export class TenantsService {
  async listTenants(query: ListTenantsQuery): Promise<PaginatedResult<unknown>> {
    const { page, limit, skip } = parsePagination(query.page, query.limit);

    const where: Prisma.TenantWhereInput = {
      deletedAt: null,
      ...(query.status ? { status: query.status as TenantStatus } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { slug: { contains: query.search, mode: 'insensitive' } },
              { email: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.tenant.findMany({ where, select: tenantSelect, skip, take: limit, orderBy: { createdAt: 'desc' } }),
      prisma.tenant.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  async getTenantById(id: string): Promise<unknown> {
    const tenant = await prisma.tenant.findFirst({
      where: { id, deletedAt: null },
      select: tenantSelect,
    });

    if (!tenant) {
      throw ApiError.notFound('Tenant');
    }

    return tenant;
  }

  async createTenant(input: CreateTenantInput): Promise<unknown> {
    // Check slug uniqueness
    const existing = await prisma.tenant.findUnique({ where: { slug: input.slug } });
    if (existing) {
      throw ApiError.conflict(`Tenant with slug "${input.slug}" already exists`);
    }

    const tenant = await prisma.tenant.create({
      data: {
        name: input.name,
        slug: input.slug,
        domain: input.domain ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        address: input.address ?? null,
        timezone: input.timezone,
        locale: input.locale,
        status: TenantStatus.TRIAL,
      },
      select: tenantSelect,
    });

    return tenant;
  }

  async updateTenant(id: string, input: UpdateTenantInput): Promise<unknown> {
    const existing = await prisma.tenant.findFirst({ where: { id, deletedAt: null } });
    if (!existing) {
      throw ApiError.notFound('Tenant');
    }

    const updated = await prisma.tenant.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.domain !== undefined ? { domain: input.domain } : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.address !== undefined ? { address: input.address } : {}),
        ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
        ...(input.locale !== undefined ? { locale: input.locale } : {}),
        ...(input.status !== undefined ? { status: input.status as TenantStatus } : {}),
        ...(input.logoUrl !== undefined ? { logoUrl: input.logoUrl } : {}),
        ...(input.settings !== undefined ? { settings: input.settings as object } : {}),
      },
      select: tenantSelect,
    });

    // Invalidate all cached tenant lookups for this tenant
    await cacheDeletePattern(`tenant:${id}*`);
    await cacheDeletePattern(`tenant:${existing.slug}*`);

    return updated;
  }

  async deleteTenant(id: string): Promise<void> {
    const existing = await prisma.tenant.findFirst({ where: { id, deletedAt: null } });
    if (!existing) {
      throw ApiError.notFound('Tenant');
    }

    await prisma.tenant.update({
      where: { id },
      data: { deletedAt: new Date(), status: TenantStatus.CANCELLED },
    });

    await cacheDeletePattern(`tenant:${id}*`);
    await cacheDeletePattern(`tenant:${existing.slug}*`);
  }
}

export const tenantsService = new TenantsService();
