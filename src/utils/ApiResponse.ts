import { Response } from 'express';

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

export interface ApiResponseShape<T> {
  success: true;
  message: string;
  data: T;
  meta?: PaginationMeta | Record<string, unknown>;
}

export class ApiResponse {
  static success<T>(
    res: Response,
    data: T,
    message = 'Success',
    statusCode = 200,
    meta?: PaginationMeta | Record<string, unknown>,
  ): void {
    const body: ApiResponseShape<T> = {
      success: true,
      message,
      data,
      ...(meta !== undefined ? { meta } : {}),
    };
    res.status(statusCode).json(body);
  }

  static created<T>(res: Response, data: T, message = 'Created successfully'): void {
    ApiResponse.success(res, data, message, 201);
  }

  static noContent(res: Response): void {
    res.status(204).end();
  }

  static paginated<T>(
    res: Response,
    data: T[],
    pagination: { page: number; limit: number; total: number },
    message = 'Success',
  ): void {
    const totalPages = Math.ceil(pagination.total / pagination.limit);
    const meta: PaginationMeta = {
      page: pagination.page,
      limit: pagination.limit,
      total: pagination.total,
      totalPages,
      hasNextPage: pagination.page < totalPages,
      hasPrevPage: pagination.page > 1,
    };
    ApiResponse.success(res, data, message, 200, meta);
  }
}

// Pagination utilities
export interface PaginationParams {
  page: number;
  limit: number;
  skip: number;
}

export function parsePagination(
  page: unknown,
  limit: unknown,
  maxLimit = 100,
): PaginationParams {
  const p = Math.max(1, Number(page) || 1);
  const l = Math.min(maxLimit, Math.max(1, Number(limit) || 20));
  return { page: p, limit: l, skip: (p - 1) * l };
}
