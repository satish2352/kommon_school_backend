import { ApiError } from '@/utils/ApiError';
import { logger } from '@/config/logger';
import { razorpayConfigsRepository } from './razorpayConfigs.repository';
import type {
  CreateRazorpayConfigInput,
  UpdateRazorpayConfigInput,
} from './razorpayConfigs.schema';

export class RazorpayConfigsService {
  async create(input: CreateRazorpayConfigInput) {
    const config = await razorpayConfigsRepository.create({
      name: input.name,
      keyId: input.keyId,
      keySecret: input.keySecret,
      webhookSecret: input.webhookSecret,
      mode: input.mode,
      tenantId: input.tenantId ?? null,
    });

    logger.info({ configId: config.id, name: config.name }, 'RazorpayConfig created');
    return config;
  }

  async list(tenantId?: string | null) {
    return razorpayConfigsRepository.list(tenantId);
  }

  async update(id: string, input: UpdateRazorpayConfigInput) {
    const existing = await razorpayConfigsRepository.findById(id);
    if (!existing) throw ApiError.notFound('RazorpayConfig');

    const updated = await razorpayConfigsRepository.update(id, {
      name: input.name,
      keyId: input.keyId,
      keySecret: input.keySecret,
      webhookSecret: input.webhookSecret,
      mode: input.mode,
    });

    logger.info({ configId: id }, 'RazorpayConfig updated');
    return updated;
  }

  async activate(id: string) {
    const existing = await razorpayConfigsRepository.findById(id);
    if (!existing) throw ApiError.notFound('RazorpayConfig');

    const activated = await razorpayConfigsRepository.activate(id);

    logger.info({ configId: id }, 'RazorpayConfig activated');
    return activated;
  }

  async delete(id: string) {
    const existing = await razorpayConfigsRepository.findById(id);
    if (!existing) throw ApiError.notFound('RazorpayConfig');

    if (existing.isActive) {
      throw ApiError.conflict('Cannot delete the currently active Razorpay config. Activate another config first.');
    }

    await razorpayConfigsRepository.softDelete(id);

    logger.info({ configId: id }, 'RazorpayConfig deleted');
  }
}

export const razorpayConfigsService = new RazorpayConfigsService();
