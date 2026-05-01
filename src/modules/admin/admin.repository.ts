import { prisma } from '@/config/database';
import type { Prisma, PaymentStatus, SyncStatus } from '@prisma/client';
import { parsePagination } from '@/utils/ApiResponse';

export class AdminRepository {
  // ── Enrollments ───────────────────────────────────────────

  async listEnrollments(params: {
    status?: string;
    source?: string;
    from?: Date;
    to?: Date;
    page: number;
    limit: number;
  }) {
    const { skip } = parsePagination(params.page, params.limit, 100);

    const where: Prisma.EnrollmentWhereInput = {};
    if (params.status) where.status = params.status as Prisma.EnumEnrollmentStatusFilter;
    if (params.source) where.source = params.source as Prisma.EnumLeadSourceNullableFilter;
    if (params.from || params.to) {
      where.createdAt = {};
      if (params.from) where.createdAt.gte = params.from;
      if (params.to) where.createdAt.lte = params.to;
    }

    const [items, total] = await prisma.$transaction([
      prisma.enrollment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: params.limit,
        select: {
          id: true,
          enrollmentId: true,
          name: true,
          email: true,
          phone: true,
          role: true,
          education: true,
          source: true,
          status: true,
          tenantId: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.enrollment.count({ where }),
    ]);

    return { items, total, page: params.page, limit: params.limit };
  }

  // ── Payments ──────────────────────────────────────────────

  async listPayments(params: {
    status?: PaymentStatus;
    from?: Date;
    to?: Date;
    minAmount?: number;
    maxAmount?: number;
    page: number;
    limit: number;
  }) {
    const { skip } = parsePagination(params.page, params.limit, 100);

    const where: Prisma.PaymentWhereInput = {};
    if (params.status) where.status = params.status;
    if (params.from || params.to) {
      where.createdAt = {};
      if (params.from) where.createdAt.gte = params.from;
      if (params.to) where.createdAt.lte = params.to;
    }
    if (params.minAmount !== undefined || params.maxAmount !== undefined) {
      where.finalAmount = {};
      if (params.minAmount !== undefined) where.finalAmount.gte = params.minAmount;
      if (params.maxAmount !== undefined) where.finalAmount.lte = params.maxAmount;
    }

    const [items, total] = await prisma.$transaction([
      prisma.payment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: params.limit,
        select: {
          id: true,
          enrollmentId: true,
          razorpayOrderId: true,
          razorpayPaymentId: true,
          status: true,
          finalAmount: true,
          paidAmount: true,
          remainingAmount: true,
          currency: true,
          failureType: true,
          failureReason: true,
          retryCount: true,
          expiresAt: true,
          tenantId: true,
          createdAt: true,
          updatedAt: true,
          enrollment: {
            select: { enrollmentId: true, name: true, email: true },
          },
        },
      }),
      prisma.payment.count({ where }),
    ]);

    return { items, total, page: params.page, limit: params.limit };
  }

  async listFailedPayments(params: {
    from?: Date;
    to?: Date;
    page: number;
    limit: number;
  }) {
    return this.listPayments({
      ...params,
      status: 'FAILED' as PaymentStatus,
    });
  }

  // ── External API Logs ─────────────────────────────────────

  async listExternalApiLogs(params: {
    status?: SyncStatus;
    from?: Date;
    to?: Date;
    page: number;
    limit: number;
  }) {
    const { skip } = parsePagination(params.page, params.limit, 100);

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
        skip,
        take: params.limit,
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

    return { items, total, page: params.page, limit: params.limit };
  }

  // ── Follow-up Report ──────────────────────────────────────

  async getFollowUpReport(params: { tenantId?: string | null }) {
    const where: Prisma.FollowUpWhereInput = params.tenantId
      ? { tenantId: params.tenantId }
      : {};

    const [byStatus, byAssignee, converted, total] = await prisma.$transaction([
      // Status distribution
      prisma.followUp.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
        orderBy: { status: 'asc' },
      }),

      // By assignee (top 20)
      prisma.followUp.groupBy({
        by: ['assignedToId'],
        where: { ...where, assignedToId: { not: null } },
        _count: { _all: true },
        orderBy: { _count: { assignedToId: 'desc' } },
        take: 20,
      }),

      // Conversion funnel: converted in last 30d
      prisma.followUp.count({
        where: {
          ...where,
          status: 'CONVERTED',
          convertedAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        },
      }),

      // Total
      prisma.followUp.count({ where }),
    ]);

    const conversionRate = total > 0 ? (converted / total) * 100 : 0;

    return {
      total,
      byStatus: byStatus.map((r) => ({
        status: r.status,
        count: (r._count as { _all?: number })?._all ?? 0,
      })),
      byAssignee: byAssignee.map((r) => ({
        assignedToId: r.assignedToId,
        count: (r._count as { _all?: number })?._all ?? 0,
      })),
      conversionFunnel: {
        totalLeads: total,
        converted30d: converted,
        conversionRate: Math.round(conversionRate * 100) / 100,
      },
    };
  }

  // ── Dashboard ─────────────────────────────────────────────

  async getDashboard(tenantId?: string | null) {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const paymentWhere: Prisma.PaymentWhereInput = tenantId ? { tenantId } : {};
    const enrollmentWhere: Prisma.EnrollmentWhereInput = tenantId ? { tenantId: tenantId } : {};
    const followUpWhere: Prisma.FollowUpWhereInput = tenantId ? { tenantId } : {};

    const [
      todayEnrollments,
      todayRevenue,
      pendingPayments,
      followUpsDue,
    ] = await prisma.$transaction([
      // Today's enrollments
      prisma.enrollment.count({
        where: {
          ...enrollmentWhere,
          createdAt: { gte: todayStart },
        },
      }),

      // Today's revenue (sum of paidAmount for SUCCESS payments today)
      prisma.payment.aggregate({
        where: {
          ...paymentWhere,
          status: 'SUCCESS',
          updatedAt: { gte: todayStart },
        },
        _sum: { paidAmount: true },
      }),

      // Pending payments count
      prisma.payment.count({
        where: {
          ...paymentWhere,
          status: { in: ['INITIATED', 'CREATED', 'IN_PROGRESS', 'PENDING'] },
        },
      }),

      // Follow-ups due now
      prisma.followUp.count({
        where: {
          ...followUpWhere,
          nextFollowUpAt: { lte: new Date() },
          status: { notIn: ['CONVERTED', 'CLOSED', 'NOT_INTERESTED'] },
        },
      }),
    ]);

    return {
      today: {
        enrollments: todayEnrollments,
        revenuePaise: todayRevenue._sum.paidAmount ?? 0,
      },
      pending: {
        payments: pendingPayments,
        followUps: followUpsDue,
      },
    };
  }
}

export const adminRepository = new AdminRepository();
