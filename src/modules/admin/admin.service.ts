import { adminRepository } from './admin.repository';
import { parsePagination } from '@/utils/ApiResponse';
import type { PaymentStatus, SyncStatus } from '@prisma/client';

export class AdminService {
  async listEnrollments(query: {
    status?: string;
    source?: string;
    from?: string;
    to?: string;
    page?: string;
    limit?: string;
  }) {
    const { page, limit } = parsePagination(query.page, query.limit, 100);
    return adminRepository.listEnrollments({
      status: query.status,
      source: query.source,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      page,
      limit,
    });
  }

  async listPayments(query: {
    status?: string;
    from?: string;
    to?: string;
    minAmount?: string;
    maxAmount?: string;
    page?: string;
    limit?: string;
  }) {
    const { page, limit } = parsePagination(query.page, query.limit, 100);
    return adminRepository.listPayments({
      status: query.status as PaymentStatus | undefined,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      minAmount: query.minAmount ? Number(query.minAmount) : undefined,
      maxAmount: query.maxAmount ? Number(query.maxAmount) : undefined,
      page,
      limit,
    });
  }

  async listFailedPayments(query: {
    from?: string;
    to?: string;
    page?: string;
    limit?: string;
  }) {
    const { page, limit } = parsePagination(query.page, query.limit, 100);
    return adminRepository.listFailedPayments({
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      page,
      limit,
    });
  }

  async listExternalApiLogs(query: {
    status?: string;
    from?: string;
    to?: string;
    page?: string;
    limit?: string;
  }) {
    const { page, limit } = parsePagination(query.page, query.limit, 100);
    return adminRepository.listExternalApiLogs({
      status: query.status as SyncStatus | undefined,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      page,
      limit,
    });
  }

  async getFollowUpReport(tenantId?: string | null) {
    return adminRepository.getFollowUpReport({ tenantId });
  }

  async getDashboard(tenantId?: string | null) {
    return adminRepository.getDashboard(tenantId);
  }
}

export const adminService = new AdminService();
