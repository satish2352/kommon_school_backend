import { prisma } from '@/config/database';
import type { CreateEnrollmentInput, ListEnrollmentsQuery } from './enrollments.schema';
import { parsePagination } from '@/utils/ApiResponse';
import type { Prisma, EnrollmentStatus } from '@prisma/client';

export class EnrollmentsRepository {
  /**
   * Find by email or phone — used for deduplication.
   */
  async findByEmailOrPhone(email: string, phone: string) {
    return prisma.enrollment.findFirst({
      where: {
        OR: [{ email }, { phone }],
      },
      select: {
        id: true,
        enrollmentId: true,
        email: true,
        phone: true,
        status: true,
        idempotencyKey: true,
      },
    });
  }

  /**
   * Find by idempotency key — for idempotent creates.
   */
  async findByIdempotencyKey(key: string) {
    return prisma.enrollment.findUnique({
      where: { idempotencyKey: key },
    });
  }

  /**
   * Create a new enrollment.
   */
  async create(
    data: Omit<CreateEnrollmentInput, 'idempotencyKey' | 'metadata'> & {
      enrollmentId: string;
      idempotencyKey: string;
      metadata?: Prisma.InputJsonValue;
    },
  ) {
    return prisma.enrollment.create({
      data: {
        enrollmentId: data.enrollmentId,
        idempotencyKey: data.idempotencyKey,
        name: data.name,
        phone: data.phone,
        email: data.email,
        role: data.role,
        education: data.education ?? null,
        readiness: data.readiness ?? null,
        source: data.source ?? null,
        tenantId: data.tenantId ?? null,
        metadata: (data.metadata as Prisma.InputJsonValue) ?? {},
      },
    });
  }

  /**
   * Update enrollment status.
   */
  async updateStatus(id: string, status: EnrollmentStatus) {
    return prisma.enrollment.update({
      where: { id },
      data: { status },
    });
  }

  /**
   * Paginated list with optional filters.
   */
  async list(query: ListEnrollmentsQuery) {
    const { page, limit, skip } = parsePagination(query.page, query.limit, 100);

    const where: Prisma.EnrollmentWhereInput = {};

    if (query.status) where.status = query.status;
    if (query.role) where.role = query.role;
    if (query.source) where.source = query.source;
    if (query.tenantId) where.tenantId = query.tenantId;

    if (query.search) {
      const s = query.search;
      where.OR = [
        { name: { contains: s, mode: 'insensitive' } },
        { email: { contains: s, mode: 'insensitive' } },
        { phone: { contains: s } },
        { enrollmentId: { contains: s, mode: 'insensitive' } },
      ];
    }

    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) where.createdAt.gte = new Date(query.from);
      if (query.to) where.createdAt.lte = new Date(query.to);
    }

    const [items, total] = await prisma.$transaction([
      prisma.enrollment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          enrollmentId: true,
          name: true,
          phone: true,
          email: true,
          role: true,
          education: true,
          readiness: true,
          source: true,
          status: true,
          tenantId: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.enrollment.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  /**
   * Get single enrollment by id.
   */
  async findById(id: string) {
    return prisma.enrollment.findUnique({
      where: { id },
      include: {
        payments: {
          select: {
            id: true,
            razorpayOrderId: true,
            status: true,
            finalAmount: true,
            paidAmount: true,
            currency: true,
            createdAt: true,
          },
        },
        followUp: {
          select: {
            id: true,
            status: true,
            priority: true,
            assignedToId: true,
            nextFollowUpAt: true,
          },
        },
      },
    });
  }
}

export const enrollmentsRepository = new EnrollmentsRepository();
