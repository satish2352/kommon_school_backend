'use strict';

const externalRepo = require('../../externalApi/external.repository');
const ApiError = require('../../../utils/ApiError');
const logger = require('../../../config/logger');
const { parsePagination, buildMeta } = require('../../../utils/pagination');

const ALLOWED_SORT_FIELDS = ['created_at', 'updated_at'];

/**
 * Paginated list of external API logs.
 *
 * @param {object} query — raw req.query
 * @returns {Promise<{ rows: object[], meta: object }>}
 */
async function listLogs(query) {
  const { page, limit, skip, sortOrder, dateFrom, dateTo } = parsePagination(query);
  const sortBy = ALLOWED_SORT_FIELDS.includes(query.sortBy) ? query.sortBy : 'created_at';

  const where = {};

  if (query.status) {
    where.status = query.status;
  }

  if (query.enrollmentId) {
    where.enrollment_id = query.enrollmentId;
  }

  if (dateFrom || dateTo) {
    where.created_at = {};
    if (dateFrom) where.created_at.gte = dateFrom;
    if (dateTo) where.created_at.lte = dateTo;
  }

  const { rows, total } = await externalRepo.listLogsByQuery({
    skip,
    take: limit,
    where,
    orderBy: { [sortBy]: sortOrder },
  });

  logger.info({ msg: 'external_api_logs_listed', total, page, limit });

  return { rows, meta: buildMeta(page, limit, total) };
}

/**
 * Get a single external API log by ID with full request/response payloads.
 *
 * @param {string} id
 * @returns {Promise<object>}
 */
async function getLogById(id) {
  const log = await externalRepo.findLogById(id);
  if (!log) {
    throw ApiError.notFound('External API log not found');
  }
  return log;
}

module.exports = { listLogs, getLogById };
