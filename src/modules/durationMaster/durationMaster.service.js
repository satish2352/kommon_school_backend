'use strict';

const repo = require('./durationMaster.repository');
const ApiError = require('../../utils/ApiError');
const { assertNotSystemDefault } = require('../../utils/systemDefaultGuard');
const logger = require('../../config/logger');
const { buildMeta } = require('../../utils/pagination');
const { HTTP } = require('../../config/constants');

// ---------------------------------------------------------------------------
// listDurationMasters
// ---------------------------------------------------------------------------

/**
 * Return a paginated, optionally filtered list of duration master records.
 *
 * @param {object} query - validated query params (page, limit, search, status)
 * @param {string} traceId
 * @returns {Promise<{ rows: object[], meta: object }>}
 */
async function listDurationMasters(query, traceId) {
  const page  = Math.max(1, parseInt(query.page,  10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 10));
  const skip  = (page - 1) * limit;

  const where = {};

  if (query.status) {
    where.status = query.status;
  }

  if (query.search && query.search.trim()) {
    where.label = { contains: query.search.trim(), mode: 'insensitive' };
  }

  const { rows, total } = await repo.findDurationMasters({
    skip,
    take: limit,
    where,
    orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
  });

  logger.info({ msg: 'duration_master_list', traceId, total, page, limit });

  return { rows, meta: buildMeta(page, limit, total) };
}

// ---------------------------------------------------------------------------
// getDurationMasterById
// ---------------------------------------------------------------------------

/**
 * @param {number} id
 * @param {string} traceId
 * @returns {Promise<object>}
 */
async function getDurationMasterById(id, traceId) {
  const record = await repo.findDurationMasterById(id);
  if (!record) {
    logger.warn({ msg: 'duration_master_not_found', traceId, id });
    throw ApiError.notFound('Duration master record not found');
  }
  return record;
}

// ---------------------------------------------------------------------------
// createDurationMaster
// ---------------------------------------------------------------------------

/**
 * @param {object} body - validated create payload
 * @param {string} traceId
 * @returns {Promise<object>}
 */
async function createDurationMaster(body, traceId) {
  const data = {
    label:     body.label.trim(),
    sortOrder: body.sortOrder != null ? body.sortOrder : 0,
    status:    body.status || 'ACTIVE',
  };

  let record;
  try {
    record = await repo.createDurationMaster(data);
  } catch (err) {
    if (err.code === 'P2002') {
      const field = (err.meta?.target ?? []).join(', ') || 'label';
      throw new ApiError(HTTP.CONFLICT, `Duplicate value: ${field} already exists`, 'CONFLICT');
    }
    throw err;
  }

  logger.info({ msg: 'duration_master_created', traceId, id: record.id, label: record.label });

  return record;
}

// ---------------------------------------------------------------------------
// updateDurationMaster
// ---------------------------------------------------------------------------

/**
 * @param {number} id
 * @param {object} body - validated partial update payload
 * @param {string} traceId
 * @returns {Promise<object>}
 */
async function updateDurationMaster(id, body, traceId) {
  // 404 guard
  const existing = await getDurationMasterById(id, traceId);

  // Immutability guard — system-default rows cannot be modified
  assertNotSystemDefault(existing, 'Duration master record');

  const data = {};
  if (body.label     !== undefined) data.label     = body.label.trim();
  if (body.sortOrder !== undefined) data.sortOrder = body.sortOrder;
  if (body.status    !== undefined) data.status    = body.status;

  let record;
  try {
    record = await repo.updateDurationMaster(id, data);
  } catch (err) {
    if (err.code === 'P2002') {
      const field = (err.meta?.target ?? []).join(', ') || 'label';
      throw new ApiError(HTTP.CONFLICT, `Duplicate value: ${field} already exists`, 'CONFLICT');
    }
    throw err;
  }

  logger.info({ msg: 'duration_master_updated', traceId, id });

  return record;
}

// ---------------------------------------------------------------------------
// deleteDurationMaster
// ---------------------------------------------------------------------------

/**
 * @param {number} id
 * @param {string} traceId
 * @returns {Promise<void>}
 */
async function deleteDurationMaster(id, traceId) {
  // 404 guard
  const existing = await getDurationMasterById(id, traceId);

  // Immutability guard — system-default rows cannot be deleted
  assertNotSystemDefault(existing, 'Duration master record');

  // Check if any courses reference this row
  const courseCount = await repo.countCoursesByDurationId(id);
  if (courseCount > 0) {
    throw new ApiError(
      HTTP.CONFLICT,
      `Cannot delete: in use by ${courseCount} course(s)`,
      'CONFLICT',
    );
  }

  await repo.deleteDurationMaster(id);

  logger.info({ msg: 'duration_master_deleted', traceId, id });
}

module.exports = {
  listDurationMasters,
  getDurationMasterById,
  createDurationMaster,
  updateDurationMaster,
  deleteDurationMaster,
};
