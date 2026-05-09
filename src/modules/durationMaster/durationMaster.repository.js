'use strict';

const { getPrismaClient } = require('../../config/database');

function getDb() {
  return getPrismaClient();
}

/**
 * Paginated list of duration master records.
 * @param {{ skip: number, take: number, where: object, orderBy: object|object[] }} opts
 * @returns {Promise<{ rows: object[], total: number }>}
 */
async function findDurationMasters({ skip, take, where, orderBy }) {
  const [rows, total] = await getDb().$transaction([
    getDb().durationMaster.findMany({ skip, take, where, orderBy }),
    getDb().durationMaster.count({ where }),
  ]);
  return { rows, total };
}

/**
 * Find a single duration master record by integer PK.
 * @param {number} id
 * @returns {Promise<object|null>}
 */
async function findDurationMasterById(id) {
  return getDb().durationMaster.findUnique({ where: { id } });
}

/**
 * Insert a new duration master record.
 * @param {object} data
 * @returns {Promise<object>}
 */
async function createDurationMaster(data) {
  return getDb().durationMaster.create({ data });
}

/**
 * Update an existing duration master record.
 * @param {number} id
 * @param {object} data
 * @returns {Promise<object>}
 */
async function updateDurationMaster(id, data) {
  return getDb().durationMaster.update({ where: { id }, data });
}

/**
 * Hard-delete a duration master record.
 * @param {number} id
 * @returns {Promise<object>}
 */
async function deleteDurationMaster(id) {
  return getDb().durationMaster.delete({ where: { id } });
}

/**
 * Count courses that reference this duration master row.
 * @param {number} id
 * @returns {Promise<number>}
 */
async function countCoursesByDurationId(id) {
  return getDb().courseMaster.count({ where: { durationId: id } });
}

module.exports = {
  findDurationMasters,
  findDurationMasterById,
  createDurationMaster,
  updateDurationMaster,
  deleteDurationMaster,
  countCoursesByDurationId,
};
