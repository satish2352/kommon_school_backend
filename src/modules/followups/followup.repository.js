'use strict';

const { getPrismaClient } = require('../../config/database');

function getDb() {
  return getPrismaClient();
}

// Enrollment fields exposed on followup list/detail responses
const ENROLLMENT_SELECT = {
  id: true,
  first_name: true,
  last_name: true,
  email: true,
  phone_number: true,
  plan: true,
  amount: true,
  status: true,
};

/**
 * Create a new Followup record.
 *
 * @param {{ enrollment_id: string, status?: string, reason?: string, assigned_to?: string }} data
 * @returns {Promise<object>}
 */
async function createFollowup(data) {
  return getDb().followup.create({ data });
}

/**
 * Find a non-closed/non-completed followup for a given enrollment.
 * Used for idempotent auto-creation: if one already exists, return it.
 *
 * @param {string} enrollmentId
 * @returns {Promise<object|null>}
 */
async function findActiveForEnrollment(enrollmentId) {
  return getDb().followup.findFirst({
    where: {
      enrollment_id: enrollmentId,
      deleted_at: null,
      status: {
        notIn: ['payment_completed', 'followup_closed'],
      },
    },
    orderBy: { created_at: 'desc' },
  });
}

/**
 * Load a followup by PK, including its notes (asc) and a minimal enrollment summary.
 *
 * @param {string} id
 * @returns {Promise<object|null>}
 */
async function findFollowupById(id) {
  return getDb().followup.findFirst({
    where: { id, deleted_at: null },
    include: {
      notes: {
        orderBy: { created_at: 'asc' },
      },
      enrollment: {
        select: ENROLLMENT_SELECT,
      },
    },
  });
}

/**
 * Paginated list of followups.
 * Returns { rows, total } via a $transaction of findMany + count.
 *
 * @param {{ skip: number, take: number, where: object, orderBy: object }} opts
 * @returns {Promise<{ rows: object[], total: number }>}
 */
async function listFollowups({ skip, take, where, orderBy }) {
  const db = getDb();
  const [rows, total] = await db.$transaction([
    db.followup.findMany({
      skip,
      take,
      where,
      orderBy,
      include: {
        enrollment: {
          select: ENROLLMENT_SELECT,
        },
      },
    }),
    db.followup.count({ where }),
  ]);
  return { rows, total };
}

/**
 * Patch a followup row.
 *
 * @param {string} id
 * @param {object} patch
 * @returns {Promise<object>}
 */
async function updateFollowup(id, patch) {
  return getDb().followup.update({
    where: { id },
    data: patch,
  });
}

/**
 * Append a note to a followup.
 *
 * @param {{ followup_id: string, author_id: string, body: string, metadata?: object }} opts
 * @returns {Promise<object>}
 */
async function appendNote({ followup_id, author_id, body, metadata }) {
  return getDb().followupNote.create({
    data: {
      followup_id,
      author_id,
      body,
      metadata: metadata || null,
    },
  });
}

/**
 * List all notes for a followup ordered by creation time ascending.
 *
 * @param {string} followupId
 * @returns {Promise<object[]>}
 */
async function listNotes(followupId) {
  return getDb().followupNote.findMany({
    where: { followup_id: followupId },
    orderBy: { created_at: 'asc' },
  });
}

module.exports = {
  createFollowup,
  findActiveForEnrollment,
  findFollowupById,
  listFollowups,
  updateFollowup,
  appendNote,
  listNotes,
};
