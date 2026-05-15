'use strict';

const repo = require('./courseName.repository');
const ApiError = require('../../utils/ApiError');
const { assertNotSystemDefault } = require('../../utils/systemDefaultGuard');
const logger = require('../../config/logger');
const { buildMeta } = require('../../utils/pagination');
const { HTTP } = require('../../config/constants');

// ---------------------------------------------------------------------------
// listCourseNames
// ---------------------------------------------------------------------------

/**
 * Return a paginated, optionally filtered list of course name master records.
 *
 * @param {object} query - validated query params (page, limit, search, status)
 * @param {string} traceId
 * @returns {Promise<{ rows: object[], meta: object }>}
 */
async function listCourseNames(query, traceId) {
  const page  = Math.max(1, parseInt(query.page,  10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 10));
  const skip  = (page - 1) * limit;

  const where = {};

  if (query.status) {
    where.status = query.status;
  }

  if (query.search && query.search.trim()) {
    where.name = { contains: query.search.trim(), mode: 'insensitive' };
  }

  const { rows, total } = await repo.findCourseNames({
    skip,
    take: limit,
    where,
    orderBy: [{ name: 'asc' }],
  });

  logger.info({ msg: 'course_name_list', traceId, total, page, limit });

  return { rows, meta: buildMeta(page, limit, total) };
}

// ---------------------------------------------------------------------------
// getCourseNameById
// ---------------------------------------------------------------------------

/**
 * @param {number} id
 * @param {string} traceId
 * @returns {Promise<object>}
 */
async function getCourseNameById(id, traceId) {
  const record = await repo.findCourseNameById(id);
  if (!record) {
    logger.warn({ msg: 'course_name_not_found', traceId, id });
    throw ApiError.notFound('Course name record not found');
  }
  return record;
}

// ---------------------------------------------------------------------------
// createCourseName
// ---------------------------------------------------------------------------

/**
 * @param {object} body - validated create payload
 * @param {string} traceId
 * @returns {Promise<object>}
 */
async function createCourseName(body, traceId) {
  // Reject duplicate names CASE-INSENSITIVELY — "Web Dev" and "WEB DEV" and
  // "web dev" are all considered the same name. The DB column is case-sensitive
  // at the @unique level (Postgres default), so this is enforced in the service.
  const trimmed = body.name.trim();
  const existing = await repo.findCourseNameByNameInsensitive(trimmed);
  if (existing) {
    throw new ApiError(
      HTTP.CONFLICT,
      'COURSE_NAME_EXISTS',
      `A course name with this value already exists (stored as "${existing.name}")`,
    );
  }

  const data = {
    name:        trimmed,
    description: body.description ? body.description.trim() : null,
    status:      body.status || 'ACTIVE',
  };

  let record;
  try {
    record = await repo.createCourseName(data);
  } catch (err) {
    if (err.code === 'P2002') {
      throw new ApiError(HTTP.CONFLICT, 'COURSE_NAME_EXISTS', 'A course name with this value already exists');
    }
    throw err;
  }

  logger.info({ msg: 'course_name_created', traceId, id: record.id, name: record.name });

  return record;
}

// ---------------------------------------------------------------------------
// updateCourseName
// ---------------------------------------------------------------------------

/**
 * @param {number} id
 * @param {object} body - validated partial update payload
 * @param {string} traceId
 * @returns {Promise<object>}
 */
async function updateCourseName(id, body, traceId) {
  // 404 guard
  const existing = await getCourseNameById(id, traceId);

  // Immutability guard — system-default rows cannot be modified
  assertNotSystemDefault(existing, 'Course name record');

  // If name is being changed, check uniqueness CASE-INSENSITIVELY against
  // every OTHER row (excludeId=existing.id), so renaming to a case-variant of
  // another existing record is rejected.
  if (body.name !== undefined && body.name.trim().toLowerCase() !== existing.name.toLowerCase()) {
    const nameConflict = await repo.findCourseNameByNameInsensitive(body.name.trim(), existing.id);
    if (nameConflict) {
      throw new ApiError(
        HTTP.CONFLICT,
        'COURSE_NAME_EXISTS',
        `A course name with this value already exists (stored as "${nameConflict.name}")`,
      );
    }
  }

  const data = {};
  if (body.name        !== undefined) data.name        = body.name.trim();
  if (body.description !== undefined) data.description = body.description ? body.description.trim() : null;
  if (body.status      !== undefined) data.status      = body.status;

  let record;
  try {
    record = await repo.updateCourseName(id, data);
  } catch (err) {
    if (err.code === 'P2002') {
      throw new ApiError(HTTP.CONFLICT, 'COURSE_NAME_EXISTS', 'A course name with this value already exists');
    }
    throw err;
  }

  logger.info({ msg: 'course_name_updated', traceId, id });

  return record;
}

// ---------------------------------------------------------------------------
// deleteCourseName
// ---------------------------------------------------------------------------

/**
 * @param {number} id
 * @param {string} traceId
 * @returns {Promise<void>}
 */
async function deleteCourseName(id, traceId) {
  // 404 guard
  const existing = await getCourseNameById(id, traceId);

  // Immutability guard — system-default rows cannot be deleted
  assertNotSystemDefault(existing, 'Course name record');

  // Check if any courses reference this row
  const courseCount = await repo.countCoursesByCourseNameId(id);
  if (courseCount > 0) {
    throw new ApiError(
      HTTP.CONFLICT,
      'COURSE_NAME_IN_USE',
      `Cannot delete: this name is in use by ${courseCount} course offering(s)`,
    );
  }

  await repo.deleteCourseName(id);

  logger.info({ msg: 'course_name_deleted', traceId, id });
}

// ---------------------------------------------------------------------------
// upsertCourseNameByName (used by course service for legacy callers)
// ---------------------------------------------------------------------------

/**
 * Find-or-create a course_name_master row matching `name` CASE-INSENSITIVELY.
 * Used by the legacy `Courses.create` path that still accepts a free-text
 * `nameOfCourseAsGroup`. Returns the id of the matching or newly-created row.
 *
 * If an existing row matches case-insensitively, returns its id WITHOUT
 * creating a new row (preserves the stored casing of the original).
 *
 * @param {string} name
 * @returns {Promise<number>}
 */
async function upsertCourseNameByName(name) {
  const trimmed = name.trim();
  const existing = await repo.findCourseNameByNameInsensitive(trimmed);
  if (existing) return existing.id;

  // No case-insensitive match — safe to create.
  const created = await repo.createCourseName({
    name:   trimmed,
    status: 'ACTIVE',
  });
  return created.id;
}

module.exports = {
  listCourseNames,
  getCourseNameById,
  createCourseName,
  updateCourseName,
  deleteCourseName,
  upsertCourseNameByName,
};
