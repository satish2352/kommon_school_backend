'use strict';

const repo = require('./educationMaster.repository');
const ApiError = require('../../utils/ApiError');
const { assertNotSystemDefault } = require('../../utils/systemDefaultGuard');
const logger = require('../../config/logger');
const { buildMeta } = require('../../utils/pagination');
const { HTTP } = require('../../config/constants');

// ---------------------------------------------------------------------------
// listEducationMasters
// ---------------------------------------------------------------------------

/**
 * Return a paginated, optionally filtered list of education master records.
 *
 * @param {object} query - validated query params (page, limit, search, status)
 * @param {string} traceId
 * @returns {Promise<{ rows: object[], meta: object }>}
 */
async function listEducationMasters(query, traceId) {
  const page  = Math.max(1, parseInt(query.page,  10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 10));
  const skip  = (page - 1) * limit;

  const where = {};

  if (query.status) {
    where.status = query.status;
  }

  if (query.search && query.search.trim()) {
    where.OR = [
      { name: { contains: query.search.trim(), mode: 'insensitive' } },
      { code: { contains: query.search.trim(), mode: 'insensitive' } },
    ];
  }

  const { rows, total } = await repo.findEducationMasters({
    skip,
    take: limit,
    where,
    orderBy: { name: 'asc' },
  });

  logger.info({ msg: 'education_master_list', traceId, total, page, limit });

  return { rows, meta: buildMeta(page, limit, total) };
}

// ---------------------------------------------------------------------------
// getEducationMasterById
// ---------------------------------------------------------------------------

/**
 * @param {number} id
 * @param {string} traceId
 * @returns {Promise<object>}
 */
async function getEducationMasterById(id, traceId) {
  const record = await repo.findEducationMasterById(id);
  if (!record) {
    logger.warn({ msg: 'education_master_not_found', traceId, id });
    throw ApiError.notFound('Education master record not found');
  }
  return record;
}

// ---------------------------------------------------------------------------
// createEducationMaster
// ---------------------------------------------------------------------------

/**
 * @param {object} body - validated create payload
 * @param {string} traceId
 * @returns {Promise<object>}
 */
async function createEducationMaster(body, traceId) {
  const data = {
    name:        body.name.trim(),
    code:        body.code.trim().toUpperCase(),
    description: body.description || null,
    status:      body.status || 'ACTIVE',
  };

  let record;
  try {
    record = await repo.createEducationMaster(data);
  } catch (err) {
    if (err.code === 'P2002') {
      const field = (err.meta?.target ?? []).join(', ') || 'name or code';
      throw new ApiError(HTTP.CONFLICT, `Duplicate value: ${field} already exists`, 'CONFLICT');
    }
    throw err;
  }

  logger.info({ msg: 'education_master_created', traceId, id: record.id, name: record.name });

  return record;
}

// ---------------------------------------------------------------------------
// updateEducationMaster
// ---------------------------------------------------------------------------

/**
 * @param {number} id
 * @param {object} body - validated partial update payload
 * @param {string} traceId
 * @returns {Promise<object>}
 */
async function updateEducationMaster(id, body, traceId) {
  // 404 guard
  const existing = await getEducationMasterById(id, traceId);

  // Immutability guard — system-default rows cannot be modified
  assertNotSystemDefault(existing, 'Education master record');

  const data = {};
  if (body.name        !== undefined) data.name        = body.name.trim();
  if (body.code        !== undefined) data.code        = body.code.trim().toUpperCase();
  if (body.description !== undefined) data.description = body.description || null;
  if (body.status      !== undefined) data.status      = body.status;

  let record;
  try {
    record = await repo.updateEducationMaster(id, data);
  } catch (err) {
    if (err.code === 'P2002') {
      const field = (err.meta?.target ?? []).join(', ') || 'name or code';
      throw new ApiError(HTTP.CONFLICT, `Duplicate value: ${field} already exists`, 'CONFLICT');
    }
    throw err;
  }

  logger.info({ msg: 'education_master_updated', traceId, id });

  return record;
}

// ---------------------------------------------------------------------------
// deleteEducationMaster
// ---------------------------------------------------------------------------

/**
 * @param {number} id
 * @param {string} traceId
 * @returns {Promise<void>}
 */
async function deleteEducationMaster(id, traceId) {
  // 404 guard
  const existing = await getEducationMasterById(id, traceId);

  // Immutability guard — system-default rows cannot be deleted
  assertNotSystemDefault(existing, 'Education master record');

  // Check if any courses reference this row
  const courseCount = await repo.countCoursesByEducationId(id);
  if (courseCount > 0) {
    throw new ApiError(
      HTTP.CONFLICT,
      `Cannot delete: in use by ${courseCount} course(s)`,
      'CONFLICT',
    );
  }

  await repo.deleteEducationMaster(id);

  logger.info({ msg: 'education_master_deleted', traceId, id });
}

module.exports = {
  listEducationMasters,
  getEducationMasterById,
  createEducationMaster,
  updateEducationMaster,
  deleteEducationMaster,
};
