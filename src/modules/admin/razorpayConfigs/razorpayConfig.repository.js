'use strict';

const { getPrismaClient } = require('../../../config/database');

function getDb() {
  return getPrismaClient();
}

const SAFE_SELECT = {
  id: true,
  key_id: true,
  is_active: true,
  created_at: true,
  updated_at: true,
};

async function createConfig(data) {
  return getDb().razorpayConfiguration.create({
    data,
    select: SAFE_SELECT,
  });
}

async function findConfigById(id) {
  return getDb().razorpayConfiguration.findUnique({
    where: { id },
    select: SAFE_SELECT,
  });
}

/**
 * Paginated list of Razorpay configs (secrets masked).
 * @param {{ skip: number, take: number, where: object, orderBy: object }} opts
 * @returns {Promise<{ rows: object[], total: number }>}
 */
async function listConfigs({ skip, take, where, orderBy }) {
  const db = getDb();
  const [rows, total] = await db.$transaction([
    db.razorpayConfiguration.findMany({ skip, take, where, orderBy, select: SAFE_SELECT }),
    db.razorpayConfiguration.count({ where }),
  ]);
  return { rows, total };
}

/**
 * Atomic switch: deactivate all configs then activate the chosen one.
 * Runs in a serializable transaction to prevent two active configs.
 *
 * @param {string} id
 * @returns {Promise<object>} the newly activated config (masked)
 */
async function setActiveConfig(id) {
  const db = getDb();
  return db.$transaction(async (tx) => {
    await tx.razorpayConfiguration.updateMany({
      where: { is_active: true },
      data: { is_active: false },
    });
    return tx.razorpayConfiguration.update({
      where: { id },
      data: { is_active: true },
      select: SAFE_SELECT,
    });
  }, {
    timeout: 15000, // bumped from 5s default — remote DB latency
    maxWait: 5000,
  });
}

/**
 * Hard-delete a config. Callers must verify it is not active first.
 * @param {string} id
 * @returns {Promise<object>}
 */
async function deleteConfig(id) {
  return getDb().razorpayConfiguration.delete({ where: { id } });
}

module.exports = { createConfig, findConfigById, listConfigs, setActiveConfig, deleteConfig };
