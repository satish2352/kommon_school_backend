import { z } from 'zod';

export const createTenantSchema = z.object({
  body: z.object({
    name: z.string().min(2).max(200).trim(),
    slug: z
      .string()
      .min(2)
      .max(100)
      .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens only')
      .trim(),
    domain: z.string().max(253).trim().optional().nullable(),
    email: z.string().email().optional().nullable(),
    phone: z.string().max(20).trim().optional().nullable(),
    address: z.string().max(500).trim().optional().nullable(),
    timezone: z.string().default('UTC'),
    locale: z.string().default('en'),
  }),
});

export const updateTenantSchema = z.object({
  body: z.object({
    name: z.string().min(2).max(200).trim().optional(),
    domain: z.string().max(253).trim().optional().nullable(),
    email: z.string().email().optional().nullable(),
    phone: z.string().max(20).trim().optional().nullable(),
    address: z.string().max(500).trim().optional().nullable(),
    timezone: z.string().optional(),
    locale: z.string().optional(),
    status: z.enum(['ACTIVE', 'SUSPENDED', 'TRIAL', 'CANCELLED']).optional(),
    logoUrl: z.string().url().optional().nullable(),
    settings: z.record(z.unknown()).optional(),
  }),
});

export const listTenantsQuerySchema = z.object({
  query: z.object({
    page: z.string().optional().default('1'),
    limit: z.string().optional().default('20'),
    status: z.enum(['ACTIVE', 'SUSPENDED', 'TRIAL', 'CANCELLED']).optional(),
    search: z.string().max(100).optional(),
  }),
});

export const tenantIdParamSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'Tenant ID is required'),
  }),
});

export type CreateTenantInput = z.infer<typeof createTenantSchema>['body'];
export type UpdateTenantInput = z.infer<typeof updateTenantSchema>['body'];
export type ListTenantsQuery = z.infer<typeof listTenantsQuerySchema>['query'];
