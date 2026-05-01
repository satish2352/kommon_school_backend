import { Request, Response } from 'express';
import { asyncHandler } from '@/utils/asyncHandler';
import { ApiResponse } from '@/utils/ApiResponse';
import { adminService } from './admin.service';

export const listEnrollments = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const result = await adminService.listEnrollments(
    req.query as Record<string, string | undefined>,
  );
  ApiResponse.paginated(res, result.items, result, 'Enrollments retrieved');
});

export const listPayments = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const result = await adminService.listPayments(
    req.query as Record<string, string | undefined>,
  );
  ApiResponse.paginated(res, result.items, result, 'Payments retrieved');
});

export const listFailedPayments = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const result = await adminService.listFailedPayments(
    req.query as Record<string, string | undefined>,
  );
  ApiResponse.paginated(res, result.items, result, 'Failed payments retrieved');
});

export const listExternalApiLogs = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const result = await adminService.listExternalApiLogs(
    req.query as Record<string, string | undefined>,
  );
  ApiResponse.paginated(res, result.items, result, 'External API logs retrieved');
});

export const getFollowUpReport = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const tenantId = (req.query['tenantId'] as string | undefined) ?? req.user?.tenantId ?? null;
  const report = await adminService.getFollowUpReport(tenantId);
  ApiResponse.success(res, report, 'Follow-up report retrieved');
});

export const getDashboard = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const tenantId = (req.query['tenantId'] as string | undefined) ?? req.user?.tenantId ?? null;
  const dashboard = await adminService.getDashboard(tenantId);
  ApiResponse.success(res, dashboard, 'Dashboard retrieved');
});
