'use strict';

const { getPrismaClient } = require('../../config/database');

function getDb() {
  return getPrismaClient();
}

// Eager-load pricings sorted by durationMonths ascending.
const PLAN_INCLUDE = {
  pricings: {
    orderBy: { durationMonths: 'asc' },
  },
};

// ---------------------------------------------------------------------------
// Plan CRUD
// ---------------------------------------------------------------------------

/**
 * Paginated list of plans.
 * @param {{ skip: number, take: number, where: object, orderBy: object }} opts
 * @returns {Promise<{ rows: object[], total: number }>}
 */
async function findPlans({ skip, take, where, orderBy }) {
  const [rows, total] = await getDb().$transaction([
    getDb().plan.findMany({ skip, take, where, orderBy, include: PLAN_INCLUDE }),
    getDb().plan.count({ where }),
  ]);
  return { rows, total };
}

/**
 * Find a single plan by integer PK (with pricings).
 * @param {number} id
 * @returns {Promise<object|null>}
 */
async function findPlanById(id) {
  return getDb().plan.findUnique({ where: { id }, include: PLAN_INCLUDE });
}

/**
 * Insert a new plan record (with pricings).
 * @param {object} data
 * @returns {Promise<object>}
 */
async function createPlan(data) {
  return getDb().plan.create({ data, include: PLAN_INCLUDE });
}

/**
 * Update an existing plan (with pricings).
 * @param {number} id
 * @param {object} data
 * @returns {Promise<object>}
 */
async function updatePlan(id, data) {
  return getDb().plan.update({ where: { id }, data, include: PLAN_INCLUDE });
}

/**
 * Hard-delete a plan.
 * @param {number} id
 * @returns {Promise<object>}
 */
async function deletePlan(id) {
  return getDb().plan.delete({ where: { id } });
}

// ---------------------------------------------------------------------------
// PlanPricing
// ---------------------------------------------------------------------------

/**
 * Find a single PlanPricing row by its PK.
 * @param {number} pricingId
 * @returns {Promise<object|null>}
 */
async function findPricingById(pricingId) {
  return getDb().planPricing.findUnique({ where: { id: pricingId } });
}

/**
 * Find a PlanPricing by plan + duration value + unit (the unique compound key).
 * @param {number} planId
 * @param {number} durationMonths
 * @param {string} durationUnit - 'DAYS' | 'MONTHS'
 * @returns {Promise<object|null>}
 */
async function findPricingByPlanAndDuration(planId, durationMonths, durationUnit) {
  return getDb().planPricing.findUnique({
    where: { planId_durationMonths_durationUnit: { planId, durationMonths, durationUnit } },
  });
}

/**
 * Upsert a single PlanPricing row for a plan + duration value + unit combination.
 * @param {number} planId
 * @param {number} durationMonths
 * @param {string} durationUnit - 'DAYS' | 'MONTHS'
 * @param {object} data
 * @returns {Promise<object>}
 */
async function upsertPricing(planId, durationMonths, durationUnit, data) {
  return getDb().planPricing.upsert({
    where: { planId_durationMonths_durationUnit: { planId, durationMonths, durationUnit } },
    create: { planId, durationMonths, durationUnit, ...data },
    update: data,
  });
}

/**
 * Set the status of a PlanPricing row.
 * @param {number} pricingId
 * @param {'ACTIVE'|'INACTIVE'} status
 * @returns {Promise<object>}
 */
async function updatePricingStatus(pricingId, status) {
  return getDb().planPricing.update({ where: { id: pricingId }, data: { status } });
}

/**
 * Hard-delete a PlanPricing row by PK. Caller must ensure no enrollment
 * references it (FK constraint would otherwise reject the delete).
 * @param {number} pricingId
 * @returns {Promise<object>}
 */
async function deletePricing(pricingId) {
  return getDb().planPricing.delete({ where: { id: pricingId } });
}

/**
 * Find a PlanPricing by PK where status = ACTIVE.
 * @param {number} pricingId
 * @returns {Promise<object|null>}
 */
async function findActivePricingById(pricingId) {
  return getDb().planPricing.findFirst({
    where: { id: pricingId, status: 'ACTIVE' },
  });
}

// ---------------------------------------------------------------------------
// Enrollment cross-references
// ---------------------------------------------------------------------------

/**
 * Count how many non-deleted enrollments reference any pricing of a plan.
 * @param {number} planId
 * @returns {Promise<number>}
 */
async function countEnrollmentsByPlanId(planId) {
  return getDb().enrollment.count({
    where: {
      deleted_at: null,
      plan_pricing: { planId },
    },
  });
}

/**
 * Count how many non-deleted enrollments reference a specific pricing.
 * @param {number} pricingId
 * @returns {Promise<number>}
 */
async function countEnrollmentsByPricingId(pricingId) {
  return getDb().enrollment.count({
    where: { deleted_at: null, plan_pricing_id: pricingId },
  });
}

/**
 * Paginated enrollments that reference a specific PlanPricing.
 * @param {number} pricingId
 * @param {{ skip: number, take: number }} opts
 * @returns {Promise<{ rows: object[], total: number }>}
 */
async function findEnrollmentsByPricingId(pricingId, { skip, take }) {
  const [rows, total] = await getDb().$transaction([
    getDb().enrollment.findMany({
      where: { deleted_at: null, plan_pricing_id: pricingId },
      skip,
      take,
      orderBy: { created_at: 'desc' },
    }),
    getDb().enrollment.count({ where: { deleted_at: null, plan_pricing_id: pricingId } }),
  ]);
  return { rows, total };
}

/**
 * Stamp an enrollment with a selected plan pricing, amount, and status.
 * Transitions the enrollment to payment_pending.
 * @param {string} enrollmentId
 * @param {number} planPricingId
 * @param {number} amountPaise
 * @returns {Promise<object>}
 */
async function updateEnrollmentPlanPricing(enrollmentId, planPricingId, amountPaise) {
  return getDb().enrollment.update({
    where: { id: enrollmentId },
    data: {
      plan_pricing_id: planPricingId,
      amount: amountPaise,
      status: 'payment_pending',
    },
    include: {
      plan_pricing: {
        include: { plan: true },
      },
    },
  });
}

module.exports = {
  findPlans,
  findPlanById,
  createPlan,
  updatePlan,
  deletePlan,
  findPricingById,
  findPricingByPlanAndDuration,
  upsertPricing,
  updatePricingStatus,
  deletePricing,
  findActivePricingById,
  countEnrollmentsByPlanId,
  countEnrollmentsByPricingId,
  findEnrollmentsByPricingId,
  updateEnrollmentPlanPricing,
};
