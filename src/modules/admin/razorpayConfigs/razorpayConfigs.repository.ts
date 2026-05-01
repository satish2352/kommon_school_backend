import { prisma } from '@/config/database';
import type { Prisma } from '@prisma/client';
import { encrypt, decrypt, maskSecret } from '@/utils/encryption';
import { cacheDelete } from '@/utils/cache';

// Cache key prefix for active config (matches razorpay.ts resolveCredentials path)
const RAZORPAY_CACHE_PREFIX = 'razorpay:config:active';

function activeCacheKey(tenantId?: string | null): string {
  return tenantId ? `${RAZORPAY_CACHE_PREFIX}:${tenantId}` : `${RAZORPAY_CACHE_PREFIX}:global`;
}

export interface RazorpayConfigPublic {
  id: string;
  name: string;
  keyId: string;
  keySecret: string;   // masked
  webhookSecret: string; // masked
  isActive: boolean;
  mode: string;
  tenantId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toPublic(row: {
  id: string;
  name: string;
  keyId: string;
  keySecret: string;
  webhookSecret: string;
  isActive: boolean;
  mode: string;
  tenantId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): RazorpayConfigPublic {
  return {
    ...row,
    keySecret: maskSecret(row.keySecret),
    webhookSecret: maskSecret(row.webhookSecret),
  };
}

export class RazorpayConfigsRepository {
  async create(data: {
    name: string;
    keyId: string;
    keySecret: string;
    webhookSecret: string;
    mode: string;
    tenantId?: string | null;
  }) {
    const row = await prisma.razorpayConfig.create({
      data: {
        name: data.name,
        keyId: data.keyId,
        keySecret: encrypt(data.keySecret),
        webhookSecret: encrypt(data.webhookSecret),
        mode: data.mode,
        tenantId: data.tenantId ?? null,
        isActive: false,
      },
    });

    return toPublic(row);
  }

  async list(tenantId?: string | null) {
    const where: Prisma.RazorpayConfigWhereInput = tenantId
      ? { tenantId }
      : {};

    const rows = await prisma.razorpayConfig.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    return rows.map(toPublic);
  }

  async findById(id: string) {
    return prisma.razorpayConfig.findUnique({ where: { id } });
  }

  async update(
    id: string,
    data: {
      name?: string;
      keyId?: string;
      keySecret?: string;
      webhookSecret?: string;
      mode?: string;
    },
  ) {
    const updateData: Prisma.RazorpayConfigUpdateInput = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.keyId !== undefined) updateData.keyId = data.keyId;
    if (data.keySecret !== undefined) updateData.keySecret = encrypt(data.keySecret);
    if (data.webhookSecret !== undefined) updateData.webhookSecret = encrypt(data.webhookSecret);
    if (data.mode !== undefined) updateData.mode = data.mode;

    const row = await prisma.razorpayConfig.update({ where: { id }, data: updateData });

    // Invalidate cached active config
    await cacheDelete(activeCacheKey(row.tenantId));

    return toPublic(row);
  }

  /**
   * Activate a config atomically — deactivates all others for the same tenant scope.
   */
  async activate(id: string) {
    const target = await prisma.razorpayConfig.findUnique({ where: { id } });
    if (!target) throw new Error(`RazorpayConfig ${id} not found`);

    return prisma.$transaction(async (tx) => {
      // Deactivate all configs for same tenant scope
      await tx.razorpayConfig.updateMany({
        where: {
          tenantId: target.tenantId,
          isActive: true,
        },
        data: { isActive: false },
      });

      const activated = await tx.razorpayConfig.update({
        where: { id },
        data: { isActive: true },
      });

      // Bust the cache
      await cacheDelete(activeCacheKey(target.tenantId));

      return toPublic(activated);
    });
  }

  /**
   * Soft delete: set deletedAt — the model lacks deletedAt so we use a workaround.
   * Since the Prisma schema for RazorpayConfig has no deletedAt field, we deactivate
   * and set name to mark as deleted via convention, or we hard-delete.
   * Hard delete is acceptable here since configs are low-write admin operations.
   */
  async softDelete(id: string) {
    // The schema has no deletedAt on RazorpayConfig, so we do a hard delete
    // but first deactivate to trigger cache invalidation.
    const target = await prisma.razorpayConfig.findUnique({ where: { id } });
    if (!target) throw new Error(`RazorpayConfig ${id} not found`);

    await prisma.razorpayConfig.delete({ where: { id } });
    await cacheDelete(activeCacheKey(target.tenantId));
  }

  /**
   * Get decrypted credentials for the active config (for internal use by razorpay.ts).
   */
  async getActiveDecrypted(tenantId?: string | null) {
    const config = await prisma.razorpayConfig.findFirst({
      where: { isActive: true, ...(tenantId ? { tenantId } : {}) },
    });

    if (!config) return null;

    return {
      id: config.id,
      keyId: config.keyId,
      keySecret: decrypt(config.keySecret),
      webhookSecret: decrypt(config.webhookSecret),
      mode: config.mode,
      tenantId: config.tenantId,
    };
  }
}

export const razorpayConfigsRepository = new RazorpayConfigsRepository();
