import { z } from 'zod';

export const createRazorpayConfigSchema = z.object({
  name: z.string().min(1).max(100),
  keyId: z.string().min(1).max(200),
  keySecret: z.string().min(1).max(500),
  webhookSecret: z.string().min(1).max(500),
  mode: z.enum(['test', 'live']).default('test'),
  tenantId: z.string().optional(),
});

export type CreateRazorpayConfigInput = z.infer<typeof createRazorpayConfigSchema>;

export const updateRazorpayConfigSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  keyId: z.string().min(1).max(200).optional(),
  keySecret: z.string().min(1).max(500).optional(),
  webhookSecret: z.string().min(1).max(500).optional(),
  mode: z.enum(['test', 'live']).optional(),
});

export type UpdateRazorpayConfigInput = z.infer<typeof updateRazorpayConfigSchema>;

export const razorpayConfigIdSchema = z.object({
  id: z.string().min(1),
});
