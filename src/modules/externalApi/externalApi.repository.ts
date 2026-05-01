import { prisma } from '@/config/database';
import type { SyncStatus, Prisma } from '@prisma/client';

export interface CreateApiLogInput {
  paymentId?: string | null;
  enrollmentId?: string | null;
  endpoint: string;
  method?: string;
  requestBody?: unknown;
}

export interface UpdateApiLogInput {
  responseStatus?: number | null;
  responseBody?: unknown;
  syncStatus?: SyncStatus;
  retryCount?: number;
  nextRetryAt?: Date | null;
  lastAttemptAt?: Date;
  error?: string | null;
  duration?: number | null;
}

export class ExternalApiRepository {
  async create(data: CreateApiLogInput) {
    return prisma.externalApiLog.create({
      data: {
        paymentId: data.paymentId ?? null,
        enrollmentId: data.enrollmentId ?? null,
        endpoint: data.endpoint,
        method: data.method ?? 'POST',
        requestBody: data.requestBody as Prisma.InputJsonValue,
        syncStatus: 'PENDING',
      },
    });
  }

  async update(id: string, data: UpdateApiLogInput) {
    return prisma.externalApiLog.update({
      where: { id },
      data: {
        ...(data.responseStatus !== undefined ? { responseStatus: data.responseStatus } : {}),
        ...(data.responseBody !== undefined ? { responseBody: data.responseBody as Prisma.InputJsonValue } : {}),
        ...(data.syncStatus !== undefined ? { syncStatus: data.syncStatus } : {}),
        ...(data.retryCount !== undefined ? { retryCount: data.retryCount } : {}),
        ...(data.nextRetryAt !== undefined ? { nextRetryAt: data.nextRetryAt } : {}),
        ...(data.lastAttemptAt !== undefined ? { lastAttemptAt: data.lastAttemptAt } : {}),
        ...(data.error !== undefined ? { error: data.error } : {}),
        ...(data.duration !== undefined ? { duration: data.duration } : {}),
      },
    });
  }

  async findById(id: string) {
    return prisma.externalApiLog.findUnique({ where: { id } });
  }

  /**
   * Find logs eligible for retry: failed + retryCount < limit + nextRetryAt <= now.
   */
  async findRetryEligible(retryLimit: number, now: Date) {
    return prisma.externalApiLog.findMany({
      where: {
        syncStatus: 'FAILED',
        retryCount: { lt: retryLimit },
        OR: [
          { nextRetryAt: { lte: now } },
          { nextRetryAt: null },
        ],
      },
      orderBy: { nextRetryAt: 'asc' },
      take: 100,
      select: {
        id: true,
        paymentId: true,
        enrollmentId: true,
        endpoint: true,
        method: true,
        requestBody: true,
        retryCount: true,
      },
    });
  }

  /**
   * Find logs to send to DLQ: failed + retryCount >= limit.
   */
  async findDeadLetterEligible(retryLimit: number) {
    return prisma.externalApiLog.findMany({
      where: {
        syncStatus: 'FAILED',
        retryCount: { gte: retryLimit },
      },
      orderBy: { updatedAt: 'asc' },
      take: 50,
      select: { id: true, paymentId: true, enrollmentId: true, error: true, retryCount: true },
    });
  }

  async markDeadLetter(id: string) {
    return prisma.externalApiLog.update({
      where: { id },
      data: { syncStatus: 'DEAD_LETTER' },
    });
  }

  /**
   * Paginated list for admin view.
   */
  async list(params: {
    status?: SyncStatus;
    from?: Date;
    to?: Date;
    skip: number;
    take: number;
  }) {
    const where: Prisma.ExternalApiLogWhereInput = {};
    if (params.status) where.syncStatus = params.status;
    if (params.from || params.to) {
      where.createdAt = {};
      if (params.from) where.createdAt.gte = params.from;
      if (params.to) where.createdAt.lte = params.to;
    }

    const [items, total] = await prisma.$transaction([
      prisma.externalApiLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: params.skip,
        take: params.take,
        select: {
          id: true,
          paymentId: true,
          enrollmentId: true,
          endpoint: true,
          method: true,
          responseStatus: true,
          syncStatus: true,
          retryCount: true,
          nextRetryAt: true,
          lastAttemptAt: true,
          error: true,
          duration: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.externalApiLog.count({ where }),
    ]);

    return { items, total };
  }
}

export const externalApiRepository = new ExternalApiRepository();
