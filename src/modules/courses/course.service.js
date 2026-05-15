'use strict';

const repo = require('./course.repository');
const ApiError = require('../../utils/ApiError');
const { assertNotSystemDefault } = require('../../utils/systemDefaultGuard');
const logger = require('../../config/logger');
const { buildMeta } = require('../../utils/pagination');
const { getPrismaClient } = require('../../config/database');
const { HTTP } = require('../../config/constants');

// ---------------------------------------------------------------------------
// listCourses
// ---------------------------------------------------------------------------

/**
 * Return a paginated, optionally filtered list of courses.
 *
 * @param {object} query - validated query params (page, limit, search, status)
 * @param {string} traceId
 * @returns {Promise<{ rows: object[], meta: object }>}
 */
async function listCourses(query, traceId) {
  const page  = Math.max(1, parseInt(query.page,  10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 10));
  const skip  = (page - 1) * limit;

  const where = {};

  if (query.status) {
    where.status = query.status;
  }

  if (query.search && query.search.trim()) {
    where.nameOfCourseAsGroup = {
      contains: query.search.trim(),
      mode: 'insensitive',
    };
  }

  const { rows, total } = await repo.findCourses({
    skip,
    take: limit,
    where,
    orderBy: { createdAt: 'desc' },
  });

  logger.info({ msg: 'course_list', traceId, total, page, limit });

  return { rows, meta: buildMeta(page, limit, total) };
}

// ---------------------------------------------------------------------------
// getCourseById
// ---------------------------------------------------------------------------

/**
 * @param {number} id
 * @param {string} traceId
 * @returns {Promise<object>}
 */
async function getCourseById(id, traceId) {
  const course = await repo.findCourseById(id);
  if (!course) {
    logger.warn({ msg: 'course_not_found', traceId, course_id: id });
    throw ApiError.notFound('Course not found');
  }
  return course;
}

// ---------------------------------------------------------------------------
// Internal: validate educationId / durationId FK references
// ---------------------------------------------------------------------------

/**
 * Validate that an educationId (if provided) references an ACTIVE record.
 * @param {number|null|undefined} educationId
 * @param {string} traceId
 */
async function validateEducationId(educationId, traceId) {
  if (educationId == null) return;
  const db = getPrismaClient();
  const record = await db.educationMaster.findUnique({ where: { id: educationId } });
  if (!record) {
    logger.warn({ msg: 'education_master_not_found_for_course', traceId, educationId });
    throw ApiError.badRequest(`Education ID ${educationId} does not exist`);
  }
  if (record.status !== 'ACTIVE') {
    throw ApiError.badRequest(`Education ID ${educationId} is not ACTIVE`);
  }
}

/**
 * Validate that a durationId (if provided) references an ACTIVE record.
 * @param {number|null|undefined} durationId
 * @param {string} traceId
 */
async function validateDurationId(durationId, traceId) {
  if (durationId == null) return;
  const db = getPrismaClient();
  const record = await db.durationMaster.findUnique({ where: { id: durationId } });
  if (!record) {
    logger.warn({ msg: 'duration_master_not_found_for_course', traceId, durationId });
    throw ApiError.badRequest(`Duration ID ${durationId} does not exist`);
  }
  if (record.status !== 'ACTIVE') {
    throw ApiError.badRequest(`Duration ID ${durationId} is not ACTIVE`);
  }
}

// ---------------------------------------------------------------------------
// Internal: resolve courseNameId from payload (new or legacy path)
// ---------------------------------------------------------------------------

/**
 * Given the request body, resolve the courseNameId and nameOfCourseAsGroup to persist.
 *
 * Two valid input shapes:
 *   A) { courseNameId: number } — look up the name and set nameOfCourseAsGroup as denorm
 *   B) { nameOfCourseAsGroup: string } — upsert into course_name_master and return id
 *
 * Both paths set both fields for downstream compatibility.
 *
 * @param {{ courseNameId?: number, nameOfCourseAsGroup?: string }} body
 * @param {string} traceId
 * @returns {Promise<{ courseNameId: number, nameOfCourseAsGroup: string }>}
 */
async function resolveCourseNameFields(body, traceId) {
  const db = getPrismaClient();

  if (body.courseNameId != null) {
    // Path A: courseNameId provided — look up the name
    const rec = await db.courseNameMaster.findUnique({ where: { id: body.courseNameId } });
    if (!rec) {
      logger.warn({ msg: 'course_name_not_found', traceId, courseNameId: body.courseNameId });
      throw ApiError.badRequest(`CourseNameMaster ID ${body.courseNameId} does not exist`);
    }
    if (rec.status !== 'ACTIVE') {
      throw ApiError.badRequest(`CourseNameMaster ID ${body.courseNameId} is not ACTIVE`);
    }
    return { courseNameId: rec.id, nameOfCourseAsGroup: rec.name };
  }

  // Path B: nameOfCourseAsGroup provided — upsert into course_name_master
  const trimmed = body.nameOfCourseAsGroup.trim();
  const upserted = await db.courseNameMaster.upsert({
    where:  { name: trimmed },
    create: { name: trimmed, status: 'ACTIVE' },
    update: {},
  });
  return { courseNameId: upserted.id, nameOfCourseAsGroup: trimmed };
}

// ---------------------------------------------------------------------------
// Internal: check (courseNameId, durationId) uniqueness (service-level guard)
// ---------------------------------------------------------------------------

/**
 * Throws 409 COURSE_OFFERING_EXISTS if a course with the same
 * (courseNameId, durationId) pair already exists (excluding `excludeId`).
 */
async function assertCourseOfferingUnique(courseNameId, durationId, excludeId, traceId) {
  const existing = await repo.findCourseByNameDuration(courseNameId, durationId ?? null);
  if (existing && existing.id !== excludeId) {
    logger.warn({ msg: 'course_offering_duplicate', traceId, courseNameId, durationId });
    throw new ApiError(
      HTTP.CONFLICT,
      'COURSE_OFFERING_EXISTS',
      'A course offering for this Course Name + Duration already exists.',
    );
  }
}

// ---------------------------------------------------------------------------
// createCourse
// ---------------------------------------------------------------------------

/**
 * @param {object} body - validated create payload
 * @param {string} traceId
 * @returns {Promise<object>}
 */
async function createCourse(body, traceId) {
  // Validate FK references before inserting
  await validateEducationId(body.educationId, traceId);
  await validateDurationId(body.durationId, traceId);

  // Resolve normalized name fields
  const { courseNameId, nameOfCourseAsGroup } = await resolveCourseNameFields(body, traceId);

  // Enforce (courseNameId, durationId) uniqueness
  await assertCourseOfferingUnique(courseNameId, body.durationId, null, traceId);

  const data = {
    courseNameId,
    nameOfCourseAsGroup,
    courseFee:   body.courseFee,
    coupon:      body.coupon || null,
    description: body.description || null,
    status:      body.status || 'ACTIVE',
    educationId: body.educationId ?? null,
    durationId:  body.durationId ?? null,
  };

  let course;
  try {
    course = await repo.createCourse(data);
  } catch (err) {
    if (err.code === 'P2002') {
      throw new ApiError(
        HTTP.CONFLICT,
        'COURSE_OFFERING_EXISTS',
        'A course offering for this Course Name + Duration already exists.',
      );
    }
    throw err;
  }

  logger.info({ msg: 'course_created', traceId, course_id: course.id, name: course.nameOfCourseAsGroup });

  return course;
}

// ---------------------------------------------------------------------------
// updateCourse
// ---------------------------------------------------------------------------

/**
 * @param {number} id
 * @param {object} body - validated (partial) update payload
 * @param {string} traceId
 * @returns {Promise<object>}
 */
async function updateCourse(id, body, traceId) {
  // 404 guard — ensure the course exists before updating
  const existing = await getCourseById(id, traceId);

  // Immutability guard — system-default rows cannot be modified
  assertNotSystemDefault(existing, 'Course');

  // Validate FK references before updating
  if (body.educationId !== undefined) await validateEducationId(body.educationId, traceId);
  if (body.durationId  !== undefined) await validateDurationId(body.durationId, traceId);

  const data = {};

  // Resolve name fields if either name-related field is being changed
  const isNameChange = body.courseNameId != null || body.nameOfCourseAsGroup !== undefined;
  if (isNameChange) {
    const { courseNameId, nameOfCourseAsGroup } = await resolveCourseNameFields(body, traceId);
    data.courseNameId        = courseNameId;
    data.nameOfCourseAsGroup = nameOfCourseAsGroup;

    // Check uniqueness for the new (courseNameId, durationId) pair
    const effectiveDurationId = body.durationId !== undefined ? body.durationId : existing.durationId;
    await assertCourseOfferingUnique(courseNameId, effectiveDurationId, id, traceId);
  }

  // Duration change can also break uniqueness even without a name change
  if (!isNameChange && body.durationId !== undefined) {
    await assertCourseOfferingUnique(existing.courseNameId, body.durationId, id, traceId);
  }

  if (body.courseFee   !== undefined) data.courseFee   = body.courseFee;
  if (body.coupon      !== undefined) data.coupon      = body.coupon || null;
  if (body.description !== undefined) data.description = body.description || null;
  if (body.status      !== undefined) data.status      = body.status;
  if (body.educationId !== undefined) data.educationId = body.educationId ?? null;
  if (body.durationId  !== undefined) data.durationId  = body.durationId ?? null;

  let course;
  try {
    course = await repo.updateCourse(id, data);
  } catch (err) {
    if (err.code === 'P2002') {
      throw new ApiError(
        HTTP.CONFLICT,
        'COURSE_OFFERING_EXISTS',
        'A course offering for this Course Name + Duration already exists.',
      );
    }
    throw err;
  }

  logger.info({ msg: 'course_updated', traceId, course_id: id });

  return course;
}

// ---------------------------------------------------------------------------
// deleteCourse
// ---------------------------------------------------------------------------

/**
 * @param {number} id
 * @param {string} traceId
 * @returns {Promise<void>}
 */
async function deleteCourse(id, traceId) {
  // 404 guard
  const existing = await getCourseById(id, traceId);

  // Immutability guard — system-default rows cannot be deleted
  assertNotSystemDefault(existing, 'Course');

  await repo.deleteCourse(id);

  logger.info({ msg: 'course_deleted', traceId, course_id: id });
}

module.exports = {
  listCourses,
  getCourseById,
  createCourse,
  updateCourse,
  deleteCourse,
};
