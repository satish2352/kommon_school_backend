import { Request, Response } from 'express';
import { asyncHandler } from '@/utils/asyncHandler';
import { ApiResponse } from '@/utils/ApiResponse';
import { ApiError } from '@/utils/ApiError';
import { followUpsService } from './followups.service';
import type {
  CreateFollowUpInput,
  UpdateFollowUpStatusInput,
  AddInteractionInput,
  AddNoteInput,
  ListFollowUpsQuery,
} from './followups.schema';

export const createFollowUp = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const body = req.body as CreateFollowUpInput;
  if (req.tenant?.id && !body.tenantId) body.tenantId = req.tenant.id;

  const followUp = await followUpsService.createFollowUp(body, req.user?.id);
  ApiResponse.created(res, followUp, 'Follow-up created');
});

export const getFollowUp = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const id = req.params['id'];
  if (!id) throw ApiError.badRequest('Follow-up ID is required');

  const followUp = await followUpsService.getFollowUp(id);
  ApiResponse.success(res, followUp);
});

export const addInteraction = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const id = req.params['id'];
  if (!id) throw ApiError.badRequest('Follow-up ID is required');

  const body = req.body as AddInteractionInput;
  const result = await followUpsService.addInteraction(id, body, req.user?.id);
  ApiResponse.success(res, result, 'Interaction added');
});

export const addNote = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const id = req.params['id'];
  if (!id) throw ApiError.badRequest('Follow-up ID is required');

  const body = req.body as AddNoteInput;
  const result = await followUpsService.addNote(id, body, req.user?.id);
  ApiResponse.success(res, result, 'Note added');
});

export const updateStatus = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const id = req.params['id'];
  if (!id) throw ApiError.badRequest('Follow-up ID is required');

  const body = req.body as UpdateFollowUpStatusInput;
  const result = await followUpsService.updateStatus(id, body, req.user?.id);
  ApiResponse.success(res, result, 'Status updated');
});

export const listFollowUps = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const query = req.query as unknown as ListFollowUpsQuery;

  if (req.user?.role !== 'SUPER_ADMIN' && req.tenant?.id) {
    query.tenantId = req.tenant.id;
  }

  // Marketing users are scoped to their assignments
  if (req.user?.role === 'MARKETING' && !query.assignedToId) {
    query.assignedToId = req.user.id;
  }

  const result = await followUpsService.listFollowUps(query);
  ApiResponse.paginated(res, result.items, {
    page: result.page,
    limit: result.limit,
    total: result.total,
  });
});

export const getDashboard = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.tenant?.id ?? req.user?.tenantId ?? null;
  const stats = await followUpsService.getDashboard(tenantId);
  ApiResponse.success(res, stats, 'Dashboard data');
});
