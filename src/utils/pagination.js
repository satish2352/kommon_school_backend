'use strict';

const ApiError = require('./ApiError');
const { DEFAULT_PAGE, DEFAULT_LIMIT, MAX_LIMIT } = require('../config/constants');

/**
 * Hard cap on offset depth to prevent expensive deep-pagination scans.
 *
 * With offset-based pagination, the DB must materialise and discard every
 * preceding row even with the perfect covering index. A request like
 * `?page=500000&limit=100` would force a 50M-row scan on the index — a
 * pathological pattern that admin UIs never legitimately need (no human
 * pages through 500k pages of results).
 *
 * 100,000 = page 1,000 at limit 100, or page 5,000 at limit 20 — far
 * beyond any real admin's tolerance. Callers that exceed this should
 * narrow the result set with filters (status, date range, search) or
 * switch to cursor-based pagination for export-style workloads.
 */
const MAX_OFFSET = 100_000;

/**
 * Parse pagination, sorting, and date-range parameters from query string.
 * Returns sanitised values safe for use in Prisma queries.
 *
 * Throws 422 if `(page - 1) * limit` exceeds MAX_OFFSET.
 */
function parsePagination(query) {
  const page = Math.max(1, parseInt(query.page, 10) || DEFAULT_PAGE);
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(query.limit, 10) || DEFAULT_LIMIT));
  const skip = (page - 1) * limit;

  if (skip > MAX_OFFSET) {
    throw new ApiError(
      422,
      'PAGINATION_DEPTH_EXCEEDED',
      `Pagination depth exceeds the maximum of ${MAX_OFFSET} rows. ` +
      `Narrow the result set with filters (status, date range, search) ` +
      `or request a smaller page number.`,
    );
  }

  const allowedSortFields = ['created_at', 'updated_at', 'email', 'status', 'amount'];
  const sortBy = allowedSortFields.includes(query.sortBy) ? query.sortBy : 'created_at';
  const sortOrder = query.sortOrder === 'asc' ? 'asc' : 'desc';

  const dateFrom = query.dateFrom ? new Date(query.dateFrom) : undefined;
  const dateTo = query.dateTo ? new Date(query.dateTo) : undefined;

  return { page, limit, skip, sortBy, sortOrder, dateFrom, dateTo };
}

/**
 * Build the meta block for list responses. Includes hasNext/hasPrev so the
 * frontend doesn't need to do `items.length === limit` heuristics to know
 * whether to enable the Next button — that hack breaks on the last full
 * page (where length === limit but there is no next row).
 */
function buildMeta(page, limit, total) {
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, limit)));
  return {
    page,
    limit,
    total,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  };
}

module.exports = { parsePagination, buildMeta, MAX_OFFSET };
