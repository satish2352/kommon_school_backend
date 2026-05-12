'use strict';

const { getPrismaClient } = require('../../config/database');
const { ENROLLMENT_DEDUPE_WINDOW_MS } = require('../../config/constants');

function getDb() {
  return getPrismaClient();
}

/**
 * Find a recently submitted enrollment for the same email+phone within the
 * dedupe window. Edge case #10: prevents duplicate submissions from impatient
 * users double-clicking submit.
 */
async function findRecentDuplicate(email, phoneNumber) {
  const since = new Date(Date.now() - ENROLLMENT_DEDUPE_WINDOW_MS);
  return getDb().enrollment.findFirst({
    where: {
      email,
      phone_number: phoneNumber,
      status: 'submitted',
      created_at: { gte: since },
      deleted_at: null,
    },
    orderBy: { created_at: 'desc' },
  });
}

async function createEnrollment(data) {
  return getDb().enrollment.create({ data });
}

/**
 * Find any active (non-deleted) enrollment for the given email.
 * Used to enforce hard email uniqueness across all enrollment paths
 * (public website, admin manual, admin bulk CSV).
 *
 * Email is normalised to lowercase by the Joi validator on both shapes,
 * so a direct equality match is safe.
 */
async function findActiveByEmail(email) {
  return getDb().enrollment.findFirst({
    where: {
      email,
      deleted_at: null,
    },
    orderBy: { created_at: 'desc' },
  });
}

async function findEnrollmentById(id) {
  return getDb().enrollment.findFirst({
    where: { id, deleted_at: null },
    include: {
      payments: {
        orderBy: { created_at: 'desc' },
        take: 1,
      },
    },
  });
}

async function listEnrollments({ skip, take, where, orderBy }) {
  const [rows, total] = await getDb().$transaction([
    getDb().enrollment.findMany({ skip, take, where, orderBy }),
    getDb().enrollment.count({ where }),
  ]);
  return { rows, total };
}

async function updateEnrollmentStatus(id, status) {
  return getDb().enrollment.update({
    where: { id },
    data: { status },
  });
}

module.exports = {
  findRecentDuplicate,
  findActiveByEmail,
  createEnrollment,
  findEnrollmentById,
  listEnrollments,
  updateEnrollmentStatus,
};
