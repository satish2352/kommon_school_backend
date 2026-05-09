'use strict';

const { getPrismaClient } = require('../../../config/database');

function getDb() {
  return getPrismaClient();
}

const SAFE_SELECT = {
  id: true,
  email: true,
  role: true,
  created_at: true,
  updated_at: true,
  deleted_at: true,
};

async function createUser(data) {
  return getDb().user.create({
    data,
    select: SAFE_SELECT,
  });
}

async function findUserById(id) {
  return getDb().user.findUnique({
    where: { id },
    select: SAFE_SELECT,
  });
}

async function findUserByEmail(email) {
  return getDb().user.findFirst({
    where: { email },
    select: SAFE_SELECT,
  });
}

/**
 * Paginated list of users.
 * @param {{ skip: number, take: number, where: object, orderBy: object }} opts
 * @returns {Promise<{ rows: object[], total: number }>}
 */
async function listUsers({ skip, take, where, orderBy }) {
  const db = getDb();
  const [rows, total] = await db.$transaction([
    db.user.findMany({ skip, take, where, orderBy, select: SAFE_SELECT }),
    db.user.count({ where }),
  ]);
  return { rows, total };
}

async function updateUser(id, patch) {
  return getDb().user.update({
    where: { id },
    data: patch,
    select: SAFE_SELECT,
  });
}

async function softDeleteUser(id) {
  return getDb().user.update({
    where: { id },
    data: { deleted_at: new Date() },
    select: SAFE_SELECT,
  });
}

module.exports = {
  createUser,
  findUserById,
  findUserByEmail,
  listUsers,
  updateUser,
  softDeleteUser,
};
