import { prisma } from '@/config/database';
import { parsePagination } from '@/utils/ApiResponse';
import type { Prisma, FollowUpStatus, FollowUpPriority } from '@prisma/client';
import type { ListFollowUpsQuery } from './followups.schema';

export interface NoteRecord {
  id: string;
  content: string;
  createdAt: string;
  createdBy: string;
  metadata?: Record<string, unknown>;
}

export interface InteractionRecord {
  id: string;
  type: string;
  outcome: string;
  userResponse?: string;
  callDuration?: number;
  remarks?: string;
  nextAction?: string;
  nextFollowUpAt?: string;
  createdAt: string;
  createdBy: string;
  metadata?: Record<string, unknown>;
}

export interface HistoryRecord {
  at: string;
  event: string;
  fromStatus?: string;
  toStatus?: string;
  actor: string;
  reason?: string;
}

export class FollowUpsRepository {
  async findById(id: string) {
    return prisma.followUp.findUnique({
      where: { id },
      include: {
        enrollment: {
          select: {
            id: true,
            enrollmentId: true,
            name: true,
            email: true,
            phone: true,
            role: true,
            source: true,
          },
        },
        assignedTo: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    });
  }

  async findByEnrollmentId(enrollmentId: string) {
    return prisma.followUp.findUnique({
      where: { enrollmentId },
    });
  }

  async create(data: {
    enrollmentId: string;
    assignedToId?: string | null;
    status: FollowUpStatus;
    priority: FollowUpPriority;
    nextFollowUpAt?: Date | null;
    tags?: string[];
    paymentIntent?: Prisma.InputJsonValue;
    notes?: Prisma.InputJsonValue;
    history: Prisma.InputJsonValue;
    tenantId?: string | null;
  }) {
    return prisma.followUp.create({ data });
  }

  async update(
    id: string,
    data: Partial<{
      status: FollowUpStatus;
      priority: FollowUpPriority;
      assignedToId: string | null;
      nextFollowUpAt: Date | null;
      lastActivityAt: Date;
      convertedAt: Date | null;
      closedAt: Date | null;
      dueAt: Date | null;
      tags: string[];
      paymentIntent: Prisma.InputJsonValue;
      notes: Prisma.InputJsonValue;
      interactions: Prisma.InputJsonValue;
      history: Prisma.InputJsonValue;
      metadata: Prisma.InputJsonValue;
      callAttempts: number;
    }>,
  ) {
    return prisma.followUp.update({ where: { id }, data });
  }

  async list(query: ListFollowUpsQuery) {
    const { page, limit, skip } = parsePagination(query.page, query.limit, 100);

    const where: Prisma.FollowUpWhereInput = {};

    if (query.status) where.status = query.status;
    if (query.priority) where.priority = query.priority;
    if (query.assignedToId) where.assignedToId = query.assignedToId;
    if (query.tenantId) where.tenantId = query.tenantId;

    if (query.overdue) {
      where.nextFollowUpAt = { lte: new Date() };
      where.status = {
        notIn: ['CONVERTED', 'CLOSED', 'NOT_INTERESTED'],
      };
    }

    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) where.createdAt.gte = new Date(query.from);
      if (query.to) where.createdAt.lte = new Date(query.to);
    }

    if (query.search) {
      where.enrollment = {
        OR: [
          { name: { contains: query.search, mode: 'insensitive' } },
          { email: { contains: query.search, mode: 'insensitive' } },
          { phone: { contains: query.search } },
        ],
      };
    }

    const [items, total] = await prisma.$transaction([
      prisma.followUp.findMany({
        where,
        orderBy: [{ priority: 'desc' }, { nextFollowUpAt: 'asc' }, { createdAt: 'desc' }],
        skip,
        take: limit,
        include: {
          enrollment: {
            select: {
              id: true,
              enrollmentId: true,
              name: true,
              email: true,
              phone: true,
              role: true,
              source: true,
            },
          },
          assignedTo: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
        },
      }),
      prisma.followUp.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  async findDue(now: Date) {
    return prisma.followUp.findMany({
      where: {
        nextFollowUpAt: { lte: now },
        status: { notIn: ['CONVERTED', 'CLOSED', 'NOT_INTERESTED'] },
        dueAt: null, // not yet marked due
      },
      select: { id: true, enrollmentId: true, nextFollowUpAt: true },
      take: 500,
    });
  }

  async markDue(ids: string[]) {
    return prisma.followUp.updateMany({
      where: { id: { in: ids } },
      data: { dueAt: new Date() },
    });
  }

  async findStaleLeads(staleBeforeDate: Date) {
    return prisma.followUp.findMany({
      where: {
        status: { notIn: ['CONVERTED', 'CLOSED', 'NOT_INTERESTED'] },
        lastActivityAt: { lt: staleBeforeDate },
      },
      select: { id: true, status: true, lastActivityAt: true },
      take: 200,
    });
  }

  async findAutoCloseEligible() {
    return prisma.followUp.findMany({
      where: {
        status: 'NOT_INTERESTED',
        closedAt: null,
        updatedAt: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }, // 7 days old
      },
      select: { id: true },
      take: 200,
    });
  }

  /**
   * Dashboard aggregates.
   */
  async getDashboardStats(tenantId?: string | null) {
    const where: Prisma.FollowUpWhereInput = tenantId ? { tenantId } : {};

    const [byStatus, overdueCount, convertedThisWeek] = await prisma.$transaction([
      prisma.followUp.groupBy({
        by: ['status'],
        where,
        orderBy: { status: 'asc' },
        _count: { _all: true },
      }),
      prisma.followUp.count({
        where: {
          ...where,
          nextFollowUpAt: { lte: new Date() },
          status: { notIn: ['CONVERTED', 'CLOSED', 'NOT_INTERESTED'] },
        },
      }),
      prisma.followUp.count({
        where: {
          ...where,
          status: 'CONVERTED',
          convertedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        },
      }),
    ]);

    return { byStatus, overdueCount, convertedThisWeek };
  }
}

export const followUpsRepository = new FollowUpsRepository();
