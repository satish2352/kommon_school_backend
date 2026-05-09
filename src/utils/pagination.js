'use strict';

const { DEFAULT_PAGE, DEFAULT_LIMIT, MAX_LIMIT } = require('../config/constants');

/**
 * Parse pagination, sorting, and date-range parameters from query string.
 * Returns sanitised values safe for use in Prisma queries.
 */
function parsePagination(query) {
  const page = Math.max(1, parseInt(query.page, 10) || DEFAULT_PAGE);
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(query.limit, 10) || DEFAULT_LIMIT));
  const skip = (page - 1) * limit;

  const allowedSortFields = ['created_at', 'updated_at', 'email', 'status', 'amount'];
  const sortBy = allowedSortFields.includes(query.sortBy) ? query.sortBy : 'created_at';
  const sortOrder = query.sortOrder === 'asc' ? 'asc' : 'desc';

  const dateFrom = query.dateFrom ? new Date(query.dateFrom) : undefined;
  const dateTo = query.dateTo ? new Date(query.dateTo) : undefined;

  return { page, limit, skip, sortBy, sortOrder, dateFrom, dateTo };
}

/**
 * Build the meta block for list responses.
 */
function buildMeta(page, limit, total) {
  return {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  };
}

module.exports = { parsePagination, buildMeta };
