'use strict';

const { getPrismaClient } = require('../../config/database');

function getDb() {
  return getPrismaClient();
}

/**
 * Paginated list of course name master records.
 * @param {{ skip: number, take: number, where: object, orderBy: object|object[] }} opts
 * @returns {Promise<{ rows: object[], total: number }>}
 */
async function findCourseNames({ skip, take, where, orderBy }) {
  const [rows, total] = await getDb().$transaction([
    getDb().courseNameMaster.findMany({
      skip,
      take,
      where,
      orderBy,
      include: { _count: { select: { courses: true } } },
    }),
    getDb().courseNameMaster.count({ where }),
  ]);
  // Flatten _count into courseCount for easier consumption
  return {
    rows: rows.map((r) => ({ ...r, courseCount: r._count.courses, _count: undefined })),
    total,
  };
}

/**
 * Find a single course name master record by integer PK.
 * @param {number} id
 * @returns {Promise<object|null>}
 */
async function findCourseNameById(id) {
  const rec = await getDb().courseNameMaster.findUnique({
    where: { id },
    include: { _count: { select: { courses: true } } },
  });
  if (!rec) return null;
  return { ...rec, courseCount: rec._count.courses, _count: undefined };
}

/**
 * Find a course name master record by unique name (case-sensitive).
 * @param {string} name
 * @returns {Promise<object|null>}
 */
async function findCourseNameByName(name) {
  return getDb().courseNameMaster.findUnique({ where: { name } });
}

/**
 * Find a course name master record by name, case-insensitive. Used to enforce
 * case-insensitive uniqueness — "Web Dev" and "web dev" are considered the
 * same name even though Postgres treats them as different at the column level.
 *
 * @param {string} name — already trimmed
 * @param {number} [excludeId] — optional id to exclude (for update flows)
 * @returns {Promise<object|null>}
 */
async function findCourseNameByNameInsensitive(name, excludeId) {
  const where = {
    name: { equals: name, mode: 'insensitive' },
  };
  if (excludeId != null) {
    where.id = { not: excludeId };
  }
  return getDb().courseNameMaster.findFirst({ where });
}

/**
 * Insert a new course name master record.
 * @param {object} data
 * @returns {Promise<object>}
 */
async function createCourseName(data) {
  const rec = await getDb().courseNameMaster.create({
    data,
    include: { _count: { select: { courses: true } } },
  });
  return { ...rec, courseCount: rec._count.courses, _count: undefined };
}

/**
 * Upsert a course name master record by name (idempotent).
 * @param {string} name
 * @param {object} createData
 * @returns {Promise<object>}
 */
async function upsertCourseName(name, createData) {
  return getDb().courseNameMaster.upsert({
    where: { name },
    create: createData,
    update: {},
  });
}

/**
 * Update an existing course name master record.
 * @param {number} id
 * @param {object} data
 * @returns {Promise<object>}
 */
async function updateCourseName(id, data) {
  const rec = await getDb().courseNameMaster.update({
    where: { id },
    data,
    include: { _count: { select: { courses: true } } },
  });
  return { ...rec, courseCount: rec._count.courses, _count: undefined };
}

/**
 * Hard-delete a course name master record.
 * @param {number} id
 * @returns {Promise<object>}
 */
async function deleteCourseName(id) {
  return getDb().courseNameMaster.delete({ where: { id } });
}

/**
 * Count courses that reference this course name master row.
 * @param {number} id
 * @returns {Promise<number>}
 */
async function countCoursesByCourseNameId(id) {
  return getDb().courseMaster.count({ where: { courseNameId: id } });
}

module.exports = {
  findCourseNames,
  findCourseNameById,
  findCourseNameByName,
  findCourseNameByNameInsensitive,
  createCourseName,
  upsertCourseName,
  updateCourseName,
  deleteCourseName,
  countCoursesByCourseNameId,
};
