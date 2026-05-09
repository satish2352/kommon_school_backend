'use strict';

const { getPrismaClient } = require('../../config/database');

function getDb() {
  return getPrismaClient();
}

/**
 * Paginated list of education master records.
 * @param {{ skip: number, take: number, where: object, orderBy: object }} opts
 * @returns {Promise<{ rows: object[], total: number }>}
 */
async function findEducationMasters({ skip, take, where, orderBy }) {
  const [rows, total] = await getDb().$transaction([
    getDb().educationMaster.findMany({ skip, take, where, orderBy }),
    getDb().educationMaster.count({ where }),
  ]);
  return { rows, total };
}

/**
 * Find a single education master record by integer PK.
 * @param {number} id
 * @returns {Promise<object|null>}
 */
async function findEducationMasterById(id) {
  return getDb().educationMaster.findUnique({ where: { id } });
}

/**
 * Insert a new education master record.
 * @param {object} data
 * @returns {Promise<object>}
 */
async function createEducationMaster(data) {
  return getDb().educationMaster.create({ data });
}

/**
 * Update an existing education master record.
 * @param {number} id
 * @param {object} data
 * @returns {Promise<object>}
 */
async function updateEducationMaster(id, data) {
  return getDb().educationMaster.update({ where: { id }, data });
}

/**
 * Hard-delete an education master record.
 * @param {number} id
 * @returns {Promise<object>}
 */
async function deleteEducationMaster(id) {
  return getDb().educationMaster.delete({ where: { id } });
}

/**
 * Count courses that reference this education master row.
 * @param {number} id
 * @returns {Promise<number>}
 */
async function countCoursesByEducationId(id) {
  return getDb().courseMaster.count({ where: { educationId: id } });
}

module.exports = {
  findEducationMasters,
  findEducationMasterById,
  createEducationMaster,
  updateEducationMaster,
  deleteEducationMaster,
  countCoursesByEducationId,
};
