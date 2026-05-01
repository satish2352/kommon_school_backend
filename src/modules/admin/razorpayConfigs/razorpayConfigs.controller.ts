import { Request, Response } from 'express';
import { asyncHandler } from '@/utils/asyncHandler';
import { ApiResponse } from '@/utils/ApiResponse';
import { ApiError } from '@/utils/ApiError';
import { validate } from '@/middlewares/validate.middleware';
import { razorpayConfigsService } from './razorpayConfigs.service';
import {
  createRazorpayConfigSchema,
  updateRazorpayConfigSchema,
  razorpayConfigIdSchema,
} from './razorpayConfigs.schema';

export const createConfig = [
  validate({ body: createRazorpayConfigSchema }),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const config = await razorpayConfigsService.create(req.body);
    ApiResponse.created(res, config, 'Razorpay config created');
  }),
];

export const listConfigs = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const tenantId = (req.query['tenantId'] as string | undefined) ?? req.user?.tenantId ?? null;
  const configs = await razorpayConfigsService.list(tenantId);
  ApiResponse.success(res, configs, 'Razorpay configs retrieved');
});

export const updateConfig = [
  validate({ body: updateRazorpayConfigSchema }),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const params = razorpayConfigIdSchema.safeParse(req.params);
    if (!params.success) throw ApiError.badRequest('Invalid config ID');

    const updated = await razorpayConfigsService.update(params.data.id, req.body);
    ApiResponse.success(res, updated, 'Razorpay config updated');
  }),
];

export const activateConfig = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const params = razorpayConfigIdSchema.safeParse(req.params);
  if (!params.success) throw ApiError.badRequest('Invalid config ID');

  const activated = await razorpayConfigsService.activate(params.data.id);
  ApiResponse.success(res, activated, 'Razorpay config activated');
});

export const deleteConfig = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const params = razorpayConfigIdSchema.safeParse(req.params);
  if (!params.success) throw ApiError.badRequest('Invalid config ID');

  await razorpayConfigsService.delete(params.data.id);
  ApiResponse.noContent(res);
});
