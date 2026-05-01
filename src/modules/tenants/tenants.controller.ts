import { Request, Response } from 'express';
import { asyncHandler } from '@/utils/asyncHandler';
import { ApiResponse } from '@/utils/ApiResponse';
import { tenantsService } from './tenants.service';
import type { CreateTenantInput, UpdateTenantInput, ListTenantsQuery } from './tenants.schema';

export const listTenants = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const result = await tenantsService.listTenants(req.query as unknown as ListTenantsQuery);

  ApiResponse.paginated(res, result.items as object[], {
    page: result.page,
    limit: result.limit,
    total: result.total,
  });
});

export const getTenantById = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const tenant = await tenantsService.getTenantById(req.params['id']!);
  ApiResponse.success(res, tenant);
});

export const createTenant = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const tenant = await tenantsService.createTenant(req.body as CreateTenantInput);
  ApiResponse.created(res, tenant, 'Tenant created successfully');
});

export const updateTenant = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const tenant = await tenantsService.updateTenant(req.params['id']!, req.body as UpdateTenantInput);
  ApiResponse.success(res, tenant, 'Tenant updated successfully');
});

export const deleteTenant = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  await tenantsService.deleteTenant(req.params['id']!);
  ApiResponse.noContent(res);
});
