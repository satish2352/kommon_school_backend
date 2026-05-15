'use strict';

const { getPrismaClient } = require('../../config/database');

function getDb() {
  return getPrismaClient();
}

// Include education, duration, and courseName relations in every course read.
const COURSE_INCLUDE = {
  education:  true,
  duration:   true,
  courseName: true,
};

/**
 * Paginated list of courses (with education + duration + courseName relations).
 * @param {{ skip: number, take: number, where: object, orderBy: object }} opts
 * @returns {Promise<{ rows: object[], total: number }>}
 */
async function findCourses({ skip, take, where, orderBy }) {
  const [rows, total] = await getDb().$transaction([
    getDb().courseMaster.findMany({ skip, take, where, orderBy, include: COURSE_INCLUDE }),
    getDb().courseMaster.count({ where }),
  ]);
  return { rows, total };
}

/**
 * Find a single course by integer PK (with education + duration + courseName relations).
 * @param {number} id
 * @returns {Promise<object|null>}
 */
async function findCourseById(id) {
  return getDb().courseMaster.findUnique({ where: { id }, include: COURSE_INCLUDE });
}

/**
 * Find a course by the unique (courseNameId, durationId) composite key.
 * Used for duplicate-offering detection.
 * @param {number} courseNameId
 * @param {number|null} durationId
 * @returns {Promise<object|null>}
 */
async function findCourseByNameDuration(courseNameId, durationId) {
  return getDb().courseMaster.findFirst({
    where: { courseNameId, durationId: durationId ?? null },
  });
}

/**
 * Insert a new course record (with education + duration + courseName relations).
 * @param {object} data
 * @returns {Promise<object>}
 */
async function createCourse(data) {
  return getDb().courseMaster.create({ data, include: COURSE_INCLUDE });
}

/**
 * Update an existing course (with education + duration + courseName relations).
 * @param {number} id
 * @param {object} data
 * @returns {Promise<object>}
 */
async function updateCourse(id, data) {
  return getDb().courseMaster.update({ where: { id }, data, include: COURSE_INCLUDE });
}

/**
 * Hard-delete a course.
 * @param {number} id
 * @returns {Promise<object>}
 */
async function deleteCourse(id) {
  return getDb().courseMaster.delete({ where: { id } });
}

module.exports = {
  findCourses,
  findCourseById,
  findCourseByNameDuration,
  createCourse,
  updateCourse,
  deleteCourse,
};
