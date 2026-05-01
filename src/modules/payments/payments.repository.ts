import { prisma } from '@/config/database';
import { parsePagination } from '@/utils/ApiResponse';
import type { Prisma, PaymentStatus } from '@prisma/client';
import type { ListPaymentsQuery } from './payments.schema';

export interface PaymentStatusHistoryEntry {
  from: string | null;
  to: string;
  at: string;
  actor: string;
  reason?: string;
}

export class PaymentsRepository {
  /**
   * Create a payment record with initial INITIATED status.
   */
  async createPayment(data: {
    enrollmentId: string;
    idempotencyKey: string;
    baseAmount: number;
    taxAmount: number;
    discount: number;
    finalAmount: number;
    currency: string;
    receipt: string;
    expiresAt: Date;
    tenantId?: string | null;
  }) {
    const now = new Date().toISOString();
    const statusHistory: PaymentStatusHistoryEntry[] = [
      { from: null, to: 'INITIATED', at: now, actor: 'system' },
    ];

    return prisma.payment.create({
      data: {
        enrollmentId: data.enrollmentId,
        idempotencyKey: data.idempotencyKey,
        baseAmount: data.baseAmount,
        taxAmount: data.taxAmount,
        discount: data.discount,
        finalAmount: data.finalAmount,
        currency: data.currency,
        remainingAmount: data.finalAmount,
        paidAmount: 0,
        status: 'INITIATED',
        receipt: data.receipt,
        expiresAt: data.expiresAt,
        tenantId: data.tenantId ?? null,
        startedAt: new Date(),
        statusHistory: JSON.stringify(statusHistory) as unknown as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * Update payment with Razorpay order ID (INITIATED → CREATED).
   */
  async setOrderCreated(paymentId: string, razorpayOrderId: string) {
    return this.transitionStatus(paymentId, 'CREATED', 'system', undefined, {
      razorpayOrderId,
    });
  }

  /**
   * Transition payment status with audit log.
   */
  async transitionStatus(
    paymentId: string,
    newStatus: PaymentStatus,
    actor: string,
    reason?: string,
    extraData?: Partial<Prisma.PaymentUpdateInput>,
  ) {
    return prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({
        where: { id: paymentId },
        select: { status: true, statusHistory: true },
      });

      if (!payment) throw new Error(`Payment ${paymentId} not found`);

      const history = (JSON.parse(
        typeof payment.statusHistory === 'string'
          ? payment.statusHistory
          : JSON.stringify(payment.statusHistory),
      ) as PaymentStatusHistoryEntry[]);

      history.push({
        from: payment.status,
        to: newStatus,
        at: new Date().toISOString(),
        actor,
        ...(reason ? { reason } : {}),
      });

      await tx.paymentAuditLog.create({
        data: {
          paymentId,
          fromStatus: payment.status,
          toStatus: newStatus,
          reason,
          actor,
        },
      });

      return tx.payment.update({
        where: { id: paymentId },
        data: {
          status: newStatus,
          statusHistory: JSON.stringify(history) as unknown as Prisma.InputJsonValue,
          ...extraData,
        },
      });
    });
  }

  /**
   * Mark payment as SUCCESS and create ledger entries.
   */
  async markSuccess(
    paymentId: string,
    razorpayPaymentId: string,
    razorpaySignature: string,
    paidAmount: number,
  ) {
    return prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({
        where: { id: paymentId },
        select: {
          status: true,
          statusHistory: true,
          finalAmount: true,
          enrollmentId: true,
          currency: true,
        },
      });

      if (!payment) throw new Error(`Payment ${paymentId} not found`);

      const history = JSON.parse(
        typeof payment.statusHistory === 'string'
          ? payment.statusHistory
          : JSON.stringify(payment.statusHistory),
      ) as PaymentStatusHistoryEntry[];

      const isPartial = paidAmount < payment.finalAmount;
      const newStatus: PaymentStatus = isPartial ? 'PARTIAL' : 'SUCCESS';
      const remaining = Math.max(0, payment.finalAmount - paidAmount);

      history.push({
        from: payment.status,
        to: newStatus,
        at: new Date().toISOString(),
        actor: 'webhook',
      });

      await tx.paymentAuditLog.create({
        data: {
          paymentId,
          fromStatus: payment.status,
          toStatus: newStatus,
          actor: 'webhook',
        },
      });

      const updated = await tx.payment.update({
        where: { id: paymentId },
        data: {
          status: newStatus,
          razorpayPaymentId,
          razorpaySignature,
          paidAmount,
          remainingAmount: remaining,
          clientConfirmedAt: new Date(),
          statusHistory: JSON.stringify(history) as unknown as Prisma.InputJsonValue,
        },
      });

      // Double-entry ledger
      await tx.ledgerEntry.create({
        data: {
          paymentId,
          enrollmentId: payment.enrollmentId,
          type: 'CREDIT',
          source: 'PAYMENT',
          amount: paidAmount,
          currency: payment.currency,
          reference: razorpayPaymentId,
          description: `Payment received via Razorpay`,
        },
      });

      // Update enrollment status
      await tx.enrollment.update({
        where: { id: payment.enrollmentId },
        data: {
          status: newStatus === 'SUCCESS' ? 'PAYMENT_COMPLETED' : 'PAYMENT_PENDING',
        },
      });

      return updated;
    });
  }

  /**
   * Mark payment as FAILED.
   */
  async markFailed(
    paymentId: string,
    failureType: string,
    reason: string,
    actor = 'system',
  ) {
    return this.transitionStatus(paymentId, 'FAILED', actor, reason, {
      failureType: failureType as Prisma.EnumPaymentFailureTypeNullableFilter,
      failureReason: reason,
    } as Partial<Prisma.PaymentUpdateInput>);
  }

  /**
   * Mark payment as REFUNDED and create ledger debit.
   */
  async markRefunded(
    paymentId: string,
    refundId: string,
    refundAmount: number,
    isFullRefund: boolean,
  ) {
    return prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({
        where: { id: paymentId },
        select: { status: true, statusHistory: true, paidAmount: true, currency: true, enrollmentId: true },
      });

      if (!payment) throw new Error(`Payment ${paymentId} not found`);

      const history = JSON.parse(
        typeof payment.statusHistory === 'string'
          ? payment.statusHistory
          : JSON.stringify(payment.statusHistory),
      ) as PaymentStatusHistoryEntry[];

      const newStatus: PaymentStatus = 'REFUNDED';
      history.push({
        from: payment.status,
        to: newStatus,
        at: new Date().toISOString(),
        actor: 'admin',
        reason: `Refund ${refundId}`,
      });

      await tx.paymentAuditLog.create({
        data: {
          paymentId,
          fromStatus: payment.status,
          toStatus: newStatus,
          actor: 'admin',
          reason: `Refund ${refundId}`,
        },
      });

      await tx.payment.update({
        where: { id: paymentId },
        data: {
          status: newStatus,
          paidAmount: isFullRefund ? 0 : payment.paidAmount - refundAmount,
          statusHistory: JSON.stringify(history) as unknown as Prisma.InputJsonValue,
        },
      });

      // Ledger debit for refund
      await tx.ledgerEntry.create({
        data: {
          paymentId,
          enrollmentId: payment.enrollmentId,
          type: 'DEBIT',
          source: 'REFUND',
          amount: refundAmount,
          currency: payment.currency,
          reference: refundId,
          description: `Refund issued via Razorpay`,
        },
      });
    });
  }

  /**
   * Update heartbeat.
   */
  async updateHeartbeat(paymentId: string) {
    return prisma.payment.update({
      where: { id: paymentId },
      data: {
        lastHeartbeatAt: new Date(),
        status: 'IN_PROGRESS',
      },
    });
  }

  /**
   * Find payment by ID.
   */
  async findById(id: string) {
    return prisma.payment.findUnique({
      where: { id },
      include: {
        enrollment: {
          select: {
            id: true,
            enrollmentId: true,
            name: true,
            email: true,
            phone: true,
          },
        },
        auditLogs: {
          orderBy: { createdAt: 'asc' },
          take: 50,
        },
        ledgerEntries: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });
  }

  /**
   * Find payment by idempotency key.
   */
  async findByIdempotencyKey(key: string) {
    return prisma.payment.findUnique({ where: { idempotencyKey: key } });
  }

  /**
   * Find payment by Razorpay order ID.
   */
  async findByOrderId(orderId: string) {
    return prisma.payment.findUnique({ where: { razorpayOrderId: orderId } });
  }

  /**
   * Find payments eligible for reconciliation (IN_PROGRESS/PENDING + past heartbeat).
   */
  async findStalePayments(beforeDate: Date, statuses: PaymentStatus[]) {
    return prisma.payment.findMany({
      where: {
        status: { in: statuses },
        updatedAt: { lt: beforeDate },
      },
      select: {
        id: true,
        razorpayOrderId: true,
        razorpayPaymentId: true,
        status: true,
        tenantId: true,
        retryCount: true,
        expiresAt: true,
      },
    });
  }

  /**
   * Find payments past their TTL (for expiry cron).
   */
  async findExpiredPayments() {
    return prisma.payment.findMany({
      where: {
        status: { in: ['INITIATED', 'CREATED', 'PENDING'] },
        expiresAt: { lt: new Date() },
      },
      select: { id: true, razorpayOrderId: true, expiresAt: true },
    });
  }

  /**
   * Increment retry count.
   */
  async incrementRetry(paymentId: string) {
    return prisma.payment.update({
      where: { id: paymentId },
      data: { retryCount: { increment: 1 } },
    });
  }

  /**
   * Paginated list.
   */
  async list(query: ListPaymentsQuery) {
    const { page, limit, skip } = parsePagination(query.page, query.limit, 100);

    const where: Prisma.PaymentWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.enrollmentId) where.enrollmentId = query.enrollmentId;
    if (query.tenantId) where.tenantId = query.tenantId;
    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) where.createdAt.gte = new Date(query.from);
      if (query.to) where.createdAt.lte = new Date(query.to);
    }

    const [items, total] = await prisma.$transaction([
      prisma.payment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
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
          retryCount: true,
          expiresAt: true,
          createdAt: true,
          updatedAt: true,
          enrollment: {
            select: { enrollmentId: true, name: true, email: true },
          },
        },
      }),
      prisma.payment.count({ where }),
    ]);

    return { items, total, page, limit };
  }
}

export const paymentsRepository = new PaymentsRepository();
