'use strict';

const repo = require('./plan.repository');
const enrollmentRepo = require('../enrollments/enrollment.repository');
const ApiError = require('../../utils/ApiError');
const logger = require('../../config/logger');
const { buildMeta } = require('../../utils/pagination');
const { getPrismaClient } = require('../../config/database');

// ---------------------------------------------------------------------------
// listPublic — ACTIVE plans with ACTIVE pricings, sorted by sortOrder
// ---------------------------------------------------------------------------

/**
 * Return all ACTIVE plans with ACTIVE pricings only.
 * Used by the public marketing site.
 * @param {string} traceId
 * @returns {Promise<object[]>}
 */
async function listPublic(traceId) {
  const db = getPrismaClient();
  const plans = await db.plan.findMany({
    where: { status: 'ACTIVE' },
    orderBy: { sortOrder: 'asc' },
    include: {
      pricings: {
        where: { status: 'ACTIVE' },
        orderBy: { durationMonths: 'asc' },
      },
    },
  });
  logger.info({ msg: 'plan_list_public', traceId, count: plans.length });
  return plans;
}

// ---------------------------------------------------------------------------
// listAdmin — paginated, filterable
// ---------------------------------------------------------------------------

/**
 * Return a paginated, optionally filtered list of plans (all statuses).
 * @param {object} query - validated query params (page, limit, search, tier, status)
 * @param {string} traceId
 * @returns {Promise<{ rows: object[], meta: object }>}
 */
async function listAdmin(query, traceId) {
  const page  = Math.max(1, parseInt(query.page,  10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 10));
  const skip  = (page - 1) * limit;

  const where = {};

  if (query.status) {
    where.status = query.status;
  }

  if (query.tier) {
    where.tier = query.tier;
  }

  if (query.search && query.search.trim()) {
    where.OR = [
      { name:    { contains: query.search.trim(), mode: 'insensitive' } },
      { tagline: { contains: query.search.trim(), mode: 'insensitive' } },
    ];
  }

  const { rows, total } = await repo.findPlans({
    skip,
    take: limit,
    where,
    orderBy: { sortOrder: 'asc' },
  });

  logger.info({ msg: 'plan_list_admin', traceId, total, page, limit });

  return { rows, meta: buildMeta(page, limit, total) };
}

// ---------------------------------------------------------------------------
// getById (admin — all statuses)
// ---------------------------------------------------------------------------

/**
 * @param {number} id
 * @param {string} traceId
 * @returns {Promise<object>}
 */
async function getById(id, traceId) {
  const plan = await repo.findPlanById(id);
  if (!plan) {
    logger.warn({ msg: 'plan_not_found', traceId, plan_id: id });
    throw ApiError.notFound('Plan not found');
  }
  return plan;
}

// ---------------------------------------------------------------------------
// getPublicById — S4: only returns ACTIVE plans to public callers
// ---------------------------------------------------------------------------

/**
 * Public-facing getById: returns 404 when the plan is not ACTIVE.
 * @param {number} id
 * @param {string} traceId
 * @returns {Promise<object>}
 */
async function getPublicById(id, traceId) {
  const plan = await repo.findPlanById(id);
  if (!plan || plan.status !== 'ACTIVE') {
    logger.warn({ msg: 'plan_not_found_or_inactive', traceId, plan_id: id });
    throw ApiError.notFound('Plan not found');
  }
  return plan;
}

// ---------------------------------------------------------------------------
// create — plan + pricings in one transaction
// ---------------------------------------------------------------------------

/**
 * Create a new plan, optionally with initial pricings, all in one transaction.
 * @param {object} body - validated create payload
 * @param {string} traceId
 * @returns {Promise<object>}
 */
async function create(body, traceId) {
  const db = getPrismaClient();

  // Guard: tier must be unique (Prisma will also enforce this, but give a friendly 409)
  const existing = await db.plan.findUnique({ where: { tier: body.tier } });
  if (existing) {
    throw ApiError.conflict(`A plan with tier ${body.tier} already exists`);
  }

  const planData = {
    name:           body.name,
    tier:           body.tier,
    tagline:        body.tagline || null,
    description:    body.description || null,
    features:       body.features || [],
    highlightLabel: body.highlightLabel || null,
    promoCode:      body.promoCode || null,
    sortOrder:      body.sortOrder != null ? body.sortOrder : 0,
    status:         body.status || 'ACTIVE',
    isSystemDefault: false,
  };

  const pricingRows = Array.isArray(body.pricings) ? body.pricings : [];

  const plan = await db.$transaction(async (tx) => {
    const created = await tx.plan.create({ data: planData });
    if (pricingRows.length > 0) {
      await tx.planPricing.createMany({
        data: pricingRows.map((p) => {
          const discount = p.discountPercent != null ? Number(p.discountPercent) : 0;
          const base = Number(p.basePrice);
          const computed = Math.round(base * (1 - discount / 100) * 100) / 100;
          return {
            planId:          created.id,
            durationMonths:  p.durationMonths,
            basePrice:       base,
            discountPercent: discount,
            finalPrice:      computed,
            discountLabel:   p.discountLabel || null,
            status:          p.status || 'ACTIVE',
          };
        }),
      });
    }
    return tx.plan.findUnique({
      where: { id: created.id },
      include: { pricings: { orderBy: { durationMonths: 'asc' } } },
    });
  }, {
    timeout: 15000, // bumped from 5s default — remote DB latency
    maxWait: 5000,
  });

  logger.info({ msg: 'plan_created', traceId, plan_id: plan.id, tier: plan.tier });

  return plan;
}

// ---------------------------------------------------------------------------
// update — plan metadata only
// ---------------------------------------------------------------------------

/**
 * Partial update of plan metadata (name, tagline, description, features,
 * highlightLabel, sortOrder, status). Tier is immutable.
 * @param {number} id
 * @param {object} body
 * @param {string} traceId
 * @returns {Promise<object>}
 */
async function update(id, body, traceId) {
  const existing = await getById(id, traceId);

  const data = {};
  if (body.name           !== undefined) data.name           = body.name;
  if (body.tagline        !== undefined) data.tagline        = body.tagline || null;
  if (body.description    !== undefined) data.description    = body.description || null;
  if (body.features       !== undefined) data.features       = body.features;
  if (body.highlightLabel !== undefined) data.highlightLabel = body.highlightLabel || null;
  if (body.promoCode      !== undefined) data.promoCode      = body.promoCode || null;
  if (body.sortOrder      !== undefined) data.sortOrder      = body.sortOrder;
  if (body.status         !== undefined) data.status         = body.status;

  const plan = await repo.updatePlan(existing.id, data);

  logger.info({ msg: 'plan_updated', traceId, plan_id: id });

  return plan;
}

// ---------------------------------------------------------------------------
// setStatus
// ---------------------------------------------------------------------------

/**
 * Activate or deactivate a plan.
 * @param {number} id
 * @param {'ACTIVE'|'INACTIVE'} status
 * @param {string} traceId
 * @returns {Promise<object>}
 */
async function setStatus(id, status, traceId) {
  const existing = await getById(id, traceId);
  const plan = await repo.updatePlan(existing.id, { status });
  logger.info({ msg: 'plan_status_set', traceId, plan_id: id, status });
  return plan;
}

// ---------------------------------------------------------------------------
// softDelete — blocks if enrollments reference this plan
// ---------------------------------------------------------------------------

/**
 * Delete a plan. Blocked if any enrollment references it (suggest deactivate).
 * @param {number} id
 * @param {string} traceId
 * @returns {Promise<void>}
 */
async function softDelete(id, traceId) {
  const existing = await getById(id, traceId);

  const enrollmentCount = await repo.countEnrollmentsByPlanId(existing.id);
  if (enrollmentCount > 0) {
    throw ApiError.conflict(
      `This plan has ${enrollmentCount} enrollment(s) referencing it and cannot be deleted. Consider deactivating it instead.`,
      'PLAN_IN_USE',
    );
  }

  await repo.deletePlan(existing.id);
  logger.info({ msg: 'plan_deleted', traceId, plan_id: id });
}

// ---------------------------------------------------------------------------
// upsertPricing — single duration row
// ---------------------------------------------------------------------------

/**
 * Upsert a PlanPricing for a given plan + durationMonths.
 * @param {number} planId
 * @param {number} durationMonths
 * @param {object} body
 * @param {string} traceId
 * @returns {Promise<object>}
 */
async function upsertPricing(planId, durationMonths, body, traceId) {
  // Ensure plan exists
  await getById(planId, traceId);

  const base = Number(body.basePrice);
  const discount = body.discountPercent != null ? Number(body.discountPercent) : 0;
  const computed = Math.round(base * (1 - discount / 100) * 100) / 100;

  const data = {
    basePrice:       base,
    discountPercent: discount,
    finalPrice:      computed,
    discountLabel:   body.discountLabel || null,
    status:          body.status || 'ACTIVE',
  };

  const pricing = await repo.upsertPricing(planId, durationMonths, data);
  logger.info({ msg: 'plan_pricing_upserted', traceId, plan_id: planId, duration_months: durationMonths });
  return pricing;
}

// ---------------------------------------------------------------------------
// deactivatePricing
// ---------------------------------------------------------------------------

/**
 * Deactivate (not hard-delete) a PlanPricing. Hard-delete is skipped if
 * any enrollment references this pricing.
 * @param {number} planId
 * @param {number} pricingId
 * @param {string} traceId
 * @returns {Promise<object>}
 */
async function deactivatePricing(planId, pricingId, traceId) {
  // Ensure plan exists
  await getById(planId, traceId);

  const pricing = await repo.findPricingById(pricingId);
  if (!pricing) {
    throw ApiError.notFound('Plan pricing not found');
  }
  if (pricing.planId !== planId) {
    throw ApiError.notFound('Plan pricing does not belong to this plan');
  }

  const updated = await repo.updatePricingStatus(pricingId, 'INACTIVE');
  logger.info({ msg: 'plan_pricing_deactivated', traceId, pricing_id: pricingId });
  return updated;
}

// ---------------------------------------------------------------------------
// selectForEnrollment
// ---------------------------------------------------------------------------

/**
 * Stamp an enrollment with a chosen plan pricing.
 *
 * Status guards:
 * - enrollment.status === 'submitted' → allowed (first-time selection)
 * - enrollment.status === 'payment_pending' AND no Payment rows → allowed (overwrite)
 * - anything else → 409
 *
 * Pricing guard:
 * - planPricing.status must be 'ACTIVE' → otherwise 400 PLAN_PRICING_INACTIVE
 *
 * @param {string} enrollmentId
 * @param {number} planPricingId
 * @param {string} traceId
 * @returns {Promise<{ enrollment: object, planPricing: object }>}
 */
async function selectForEnrollment(enrollmentId, planPricingId, traceId) {
  const db = getPrismaClient();

  // --- Pre-transaction: verify pricing exists and is usable (read-only, no race risk) ---
  // We do this outside the transaction so we can throw 404/400 without holding a lock.
  const planPricingCheck = await db.planPricing.findUnique({
    where: { id: planPricingId },
    include: { plan: true },
  });
  if (!planPricingCheck) {
    logger.warn({ msg: 'plan_pricing_not_found', traceId, pricing_id: planPricingId });
    throw ApiError.notFound('Plan pricing not found');
  }
  if (planPricingCheck.status !== 'ACTIVE') {
    logger.warn({ msg: 'plan_pricing_inactive', traceId, pricing_id: planPricingId });
    throw new ApiError(400, 'PLAN_PRICING_INACTIVE', 'The selected plan pricing is not available');
  }
  if (planPricingCheck.plan && planPricingCheck.plan.status !== 'ACTIVE') {
    logger.warn({ msg: 'plan_inactive', traceId, plan_id: planPricingCheck.planId });
    throw new ApiError(400, 'PLAN_INACTIVE', 'The selected plan is not available');
  }

  // --- Interactive transaction: read-check-write atomically to eliminate TOCTOU race ---
  // B2 fix: all three operations (read enrollment, count payments, update enrollment)
  // run inside a single Prisma interactive transaction.
  let updated;
  let planPricing;

  await db.$transaction(async (tx) => {
    // Re-read enrollment inside transaction (row locked by the eventual UPDATE)
    const enrollment = await tx.enrollment.findUnique({
      where: { id: enrollmentId },
    });
    // (timeout option passed to $transaction below — bumped from Prisma's 5s
    // default to 15s because the remote dev DB at 13.48.254.211 sometimes adds
    // ~3-6s of network latency per round-trip, and this transaction does 4
    // sequential round-trips: find enrollment → count payments → find pricing → update)
    if (!enrollment || enrollment.deleted_at !== null) {
      logger.warn({ msg: 'plan_select_enrollment_not_found', traceId, enrollment_id: enrollmentId });
      throw ApiError.notFound('Enrollment not found');
    }

    // S2 fix: explicit payment count inside the transaction — do not rely on take:1
    const paymentCount = await tx.payment.count({
      where: { enrollment_id: enrollmentId },
    });

    const isSubmitted = enrollment.status === 'submitted';
    const isPaymentPendingNoOrder = enrollment.status === 'payment_pending' && paymentCount === 0;

    if (!isSubmitted && !isPaymentPendingNoOrder) {
      logger.warn({
        msg:           'plan_select_enrollment_invalid_status',
        traceId,
        enrollment_id: enrollmentId,
        status:        enrollment.status,
        payment_count: paymentCount,
      });
      throw ApiError.conflict(
        'Cannot change the plan for this enrollment. It is already in progress or completed.',
      );
    }

    // Re-read pricing inside transaction (ensures it hasn't been deactivated between the
    // pre-transaction check and now)
    planPricing = await tx.planPricing.findUnique({
      where: { id: planPricingId },
      include: { plan: true },
    });
    if (!planPricing || planPricing.status !== 'ACTIVE') {
      throw new ApiError(400, 'PLAN_PRICING_INACTIVE', 'The selected plan pricing is not available');
    }
    if (planPricing.plan && planPricing.plan.status !== 'ACTIVE') {
      throw new ApiError(400, 'PLAN_INACTIVE', 'The selected plan is not available');
    }

    // Compute paise amount (round to nearest integer)
    const amountPaise = Math.round(Number(planPricing.finalPrice) * 100);

    // Stamp the enrollment inside the same transaction
    updated = await tx.enrollment.update({
      where: { id: enrollmentId },
      data: {
        plan_pricing_id: planPricingId,
        amount:          amountPaise,
        status:          'payment_pending',
      },
      include: {
        plan_pricing: {
          include: { plan: true },
        },
      },
    });
  }, {
    timeout:       15000, // 15s — see comment above. Default is 5000.
    maxWait:       5000,  // wait up to 5s to acquire a connection from pool
  });

  logger.info({
    msg:             'plan_selected_for_enrollment',
    traceId,
    enrollment_id:   enrollmentId,
    plan_pricing_id: planPricingId,
    amount_paise:    Math.round(Number(planPricing.finalPrice) * 100),
  });

  return { enrollment: updated, planPricing };
}

// ---------------------------------------------------------------------------
// enrolledUsersForPlan — paginated
// ---------------------------------------------------------------------------

/**
 * Paginated list of enrollments for a plan (across all its pricings).
 * @param {number} planId
 * @param {object} query
 * @param {string} traceId
 * @returns {Promise<{ rows: object[], meta: object }>}
 */
async function enrolledUsersForPlan(planId, query, traceId) {
  await getById(planId, traceId);

  const page  = Math.max(1, parseInt(query.page,  10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
  const skip  = (page - 1) * limit;

  const db = getPrismaClient();
  const where = {
    deleted_at: null,
    plan_pricing: { planId },
  };

  const [rows, total] = await db.$transaction([
    db.enrollment.findMany({
      where,
      skip,
      take: limit,
      orderBy: { created_at: 'desc' },
      include: { plan_pricing: { include: { plan: true } } },
    }),
    db.enrollment.count({ where }),
  ]);

  logger.info({ msg: 'plan_enrollments_list', traceId, plan_id: planId, total });

  return { rows, meta: buildMeta(page, limit, total) };
}

module.exports = {
  listPublic,
  listAdmin,
  getById,
  getPublicById,
  create,
  update,
  setStatus,
  softDelete,
  upsertPricing,
  deactivatePricing,
  selectForEnrollment,
  enrolledUsersForPlan,
};
