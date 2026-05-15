'use strict';

const { getPrismaClient } = require('../../config/database');

function getDb() {
  return getPrismaClient();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Map frontend-facing duration string (e.g. "6_MONTHS") to Prisma enum value.
 * The Prisma enum has database values like "6_MONTHS" via @map, but the
 * TypeScript/JS enum key is the Prisma-generated name (e.g. SIX_MONTHS).
 * db push keeps DB values as mapped strings; Prisma client accepts either
 * the key OR the mapped value depending on version — using the string
 * directly works because db push uses the @map value as the DB-side string
 * and Prisma Client accepts the @map value for filtering/writing.
 */
const DURATION_MAP = {
  '1_MONTH':    'ONE_MONTH',
  '3_MONTHS':   'THREE_MONTHS',
  '6_MONTHS':   'SIX_MONTHS',
  '12_MONTHS':  'TWELVE_MONTHS',
};

const DURATION_MAP_REVERSE = {
  ONE_MONTH:    '1_MONTH',
  THREE_MONTHS: '3_MONTHS',
  SIX_MONTHS:   '6_MONTHS',
  TWELVE_MONTHS:'12_MONTHS',
};

/**
 * Convert API-facing duration string to Prisma enum key.
 * @param {string} d - e.g. "6_MONTHS"
 * @returns {string} - e.g. "SIX_MONTHS"
 */
function toPrismaEnum(d) {
  return DURATION_MAP[d] || d;
}

/**
 * Normalise a raw Prisma InternalPlan record so it always uses the
 * API-contract shape (duration as "6_MONTHS", not "SIX_MONTHS").
 */
function normalise(plan) {
  if (!plan) return plan;
  return {
    ...plan,
    duration: DURATION_MAP_REVERSE[plan.duration] || plan.duration,
  };
}

function normaliseList(plans) {
  return plans.map(normalise);
}

// ---------------------------------------------------------------------------
// Read operations
// ---------------------------------------------------------------------------

/**
 * Paginated / filtered list of internal plans.
 * @param {{ skip: number, take: number, where: object, orderBy: object }} opts
 * @returns {Promise<{ rows: object[], total: number }>}
 */
async function findInternalPlans({ skip, take, where, orderBy }) {
  const [rows, total] = await getDb().$transaction([
    getDb().internalPlan.findMany({ skip, take, where, orderBy }),
    getDb().internalPlan.count({ where }),
  ]);
  return { rows: normaliseList(rows), total };
}

/**
 * Find a single internal plan by integer PK.
 * @param {number} id
 * @returns {Promise<object|null>}
 */
async function findInternalPlanById(id) {
  const plan = await getDb().internalPlan.findUnique({ where: { id } });
  return normalise(plan);
}

/**
 * List ACTIVE internal plans for a given course (no pagination — for dropdowns).
 * @param {number} courseId
 * @returns {Promise<object[]>}
 */
async function findActivePlansByCourse(courseId) {
  const plans = await getDb().internalPlan.findMany({
    where: { courseId, status: 'ACTIVE' },
    orderBy: { createdAt: 'asc' },
  });
  return normaliseList(plans);
}

// ---------------------------------------------------------------------------
// Write operations
// ---------------------------------------------------------------------------

/**
 * Insert a new internal plan record.
 * @param {object} data
 * @returns {Promise<object>}
 */
async function createInternalPlan(data) {
  const record = await getDb().internalPlan.create({
    data: {
      ...data,
      duration: toPrismaEnum(data.duration),
    },
  });
  return normalise(record);
}

/**
 * Update an existing internal plan.
 * @param {number} id
 * @param {object} data
 * @returns {Promise<object>}
 */
async function updateInternalPlan(id, data) {
  const payload = { ...data };
  if (payload.duration) {
    payload.duration = toPrismaEnum(payload.duration);
  }
  const record = await getDb().internalPlan.update({ where: { id }, data: payload });
  return normalise(record);
}

/**
 * Hard-delete an internal plan.
 * @param {number} id
 * @returns {Promise<void>}
 */
async function deleteInternalPlan(id) {
  await getDb().internalPlan.delete({ where: { id } });
}

module.exports = {
  findInternalPlans,
  findInternalPlanById,
  findActivePlansByCourse,
  createInternalPlan,
  updateInternalPlan,
  deleteInternalPlan,
  toPrismaEnum,
};
