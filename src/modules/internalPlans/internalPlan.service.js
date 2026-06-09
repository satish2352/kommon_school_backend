'use strict';

const crypto = require('crypto');
const repo = require('./internalPlan.repository');
const ApiError = require('../../utils/ApiError');
const logger = require('../../config/logger');
const { buildMeta } = require('../../utils/pagination');
const { getPrismaClient } = require('../../config/database');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generate an opaque random reference ID.
 * Mirrors mockBackend.genRefId(): `iplan_<uuid>`.
 * @returns {string}
 */
function genRefId() {
  return `iplan_${crypto.randomUUID()}`;
}

/**
 * Ensure the referenced course exists.
 * @param {number} courseId
 * @param {string} traceId
 */
async function assertCourseExists(courseId, traceId) {
  const db = getPrismaClient();
  const course = await db.courseMaster.findUnique({ where: { id: courseId } });
  if (!course) {
    logger.warn({ msg: 'internal_plan_course_not_found', traceId, courseId });
    throw ApiError.badRequest(`Course with ID ${courseId} does not exist`);
  }
  return course;
}

/**
 * Normalise coupons coming in from a create/update body.
 * Assigns sequential integer `id` and defaults `usedCount` to 0.
 * @param {object[]} rawCoupons
 * @returns {object[]}
 */
function normaliseCoupons(rawCoupons) {
  if (!Array.isArray(rawCoupons)) return [];
  return rawCoupons.map((c, idx) => ({
    id:            idx + 1,
    code:          String(c.code).toUpperCase().trim(),
    discountType:  c.discountType,
    discountValue: Number(c.discountValue),
    expiryDate:    c.expiryDate || null,
    usageLimit:    c.usageLimit != null ? Number(c.usageLimit) : null,
    usedCount:     c.usedCount != null ? Number(c.usedCount) : 0,
    status:        c.status || 'ACTIVE',
  }));
}

// ---------------------------------------------------------------------------
// Coupon validation logic (mirrors mockBackend.validateCoupon exactly)
// ---------------------------------------------------------------------------

/**
 * @param {{ code: string, plan: object, basePrice: number }} params
 * @returns {{ valid: boolean, discountAmount: number, finalAmount: number, reason?: string, coupon?: object }}
 */
function runCouponValidation({ code, plan, basePrice }) {
  const price = Number(basePrice);
  if (!isFinite(price) || price <= 0) {
    return { valid: false, discountAmount: 0, finalAmount: 0, reason: 'Course price not available' };
  }

  const coupons = Array.isArray(plan.coupons) ? plan.coupons : [];
  const coupon = coupons.find(
    (c) => String(c.code).toUpperCase() === String(code).toUpperCase().trim(),
  );

  if (!coupon) {
    return { valid: false, discountAmount: 0, finalAmount: price, reason: 'Coupon not found' };
  }

  if (coupon.status !== 'ACTIVE') {
    return { valid: false, discountAmount: 0, finalAmount: price, reason: 'Coupon is inactive' };
  }

  if (coupon.expiryDate && new Date(coupon.expiryDate) < new Date()) {
    return { valid: false, discountAmount: 0, finalAmount: price, reason: 'Coupon has expired' };
  }

  if (coupon.usageLimit != null && coupon.usedCount >= coupon.usageLimit) {
    return { valid: false, discountAmount: 0, finalAmount: price, reason: 'Coupon usage limit reached' };
  }

  let discountAmount = 0;
  if (coupon.discountType === 'PERCENT') {
    discountAmount = Math.round((price * coupon.discountValue) / 100 * 100) / 100;
  } else {
    discountAmount = Math.min(coupon.discountValue, price);
  }

  const finalAmount = Math.max(0, price - discountAmount);

  return { valid: true, discountAmount, finalAmount, coupon };
}

// ---------------------------------------------------------------------------
// listInternalPlans
// ---------------------------------------------------------------------------

/**
 * @param {object} query - validated query params
 * @param {string} traceId
 * @returns {Promise<{ rows: object[], meta: object }>}
 */
async function listInternalPlans(query, traceId) {
  const page  = Math.max(1, parseInt(query.page,  10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 10));
  const skip  = (page - 1) * limit;

  const where = {};

  if (query.status) {
    where.status = query.status;
  }

  if (query.courseId) {
    where.courseId = Number(query.courseId);
  }

  if (query.search && query.search.trim()) {
    where.name = {
      contains: query.search.trim(),
      mode: 'insensitive',
    };
  }

  const { rows, total } = await repo.findInternalPlans({
    skip,
    take: limit,
    where,
    orderBy: { createdAt: 'desc' },
  });

  logger.info({ msg: 'internal_plan_list', traceId, total, page, limit });

  return { rows, meta: buildMeta(page, limit, total) };
}

// ---------------------------------------------------------------------------
// getInternalPlanById
// ---------------------------------------------------------------------------

/**
 * @param {number} id
 * @param {string} traceId
 * @returns {Promise<object>}
 */
async function getInternalPlanById(id, traceId) {
  const plan = await repo.findInternalPlanById(id);
  if (!plan) {
    logger.warn({ msg: 'internal_plan_not_found', traceId, plan_id: id });
    throw ApiError.notFound(`Internal plan ${id} not found`);
  }
  return plan;
}

// ---------------------------------------------------------------------------
// createInternalPlan
// ---------------------------------------------------------------------------

/**
 * @param {object} body - validated create payload
 * @param {string} traceId
 * @returns {Promise<object>}
 */
async function createInternalPlan(body, traceId) {
  await assertCourseExists(Number(body.courseId), traceId);

  const externalPlanId = String(body.externalPlanId).trim();
  // Pre-flight collision check. Prisma's P2002 is generic; this returns
  // a clean 409 with the colliding plan's identity for the admin UI.
  const db = getPrismaClient();
  const collision = await db.internalPlan.findFirst({
    where:  { externalPlanId },
    select: { id: true, name: true },
  });
  if (collision) {
    throw ApiError.conflict(
      `Plan ID "${externalPlanId}" is already used by internal plan "${collision.name}" (id ${collision.id})`,
      'EXTERNAL_PLAN_ID_TAKEN',
    );
  }

  const data = {
    refId:       genRefId(),
    name:        body.name.trim(),
    duration:    body.duration,
    description: body.description?.trim() ?? null,
    courseId:    Number(body.courseId),
    status:      body.status || 'ACTIVE',
    coupons:     normaliseCoupons(body.coupons),
    externalPlanId,
  };

  const plan = await repo.createInternalPlan(data);

  logger.info({ msg: 'internal_plan_created', traceId, plan_id: plan.id, refId: plan.refId });

  return plan;
}

// ---------------------------------------------------------------------------
// updateInternalPlan
// ---------------------------------------------------------------------------

/**
 * @param {number} id
 * @param {object} body - validated (partial) update payload
 * @param {string} traceId
 * @returns {Promise<object>}
 */
async function updateInternalPlan(id, body, traceId) {
  // 404 guard + grab the live row so we can defensively merge usedCount
  // from existing coupons. Even though the validator now accepts the
  // `usedCount` field, this preserves the counter for any caller that
  // forgets to send it (mock backend / future SDKs / hand-rolled curl).
  const existing = await getInternalPlanById(id, traceId);

  if (body.courseId !== undefined) {
    await assertCourseExists(Number(body.courseId), traceId);
  }

  const data = {};
  if (body.name        !== undefined) data.name        = body.name.trim();
  if (body.duration    !== undefined) data.duration    = body.duration;
  if (body.description !== undefined) data.description = body.description?.trim() ?? null;
  if (body.courseId    !== undefined) data.courseId    = Number(body.courseId);
  if (body.status      !== undefined) data.status      = body.status;
  if (body.externalPlanId !== undefined) {
    const externalPlanId = String(body.externalPlanId).trim();
    // Cross-plan collision check that excludes this row.
    const db = getPrismaClient();
    const collision = await db.internalPlan.findFirst({
      where: {
        externalPlanId,
        NOT: { id },
      },
      select: { id: true, name: true },
    });
    if (collision) {
      throw ApiError.conflict(
        `Plan ID "${externalPlanId}" is already used by internal plan "${collision.name}" (id ${collision.id})`,
        'EXTERNAL_PLAN_ID_TAKEN',
      );
    }
    data.externalPlanId = externalPlanId;
  }

  if (Array.isArray(body.coupons)) {
    // Build a code → usedCount map from the existing plan so we can
    // restore the counter for any coupon the caller didn't carry forward.
    // Code-keyed (case-insensitive) — survives id renumbering by
    // normaliseCoupons which assigns sequential ids based on array order.
    const liveCoupons = Array.isArray(existing.coupons) ? existing.coupons : [];
    const liveUsedByCode = new Map();
    for (const c of liveCoupons) {
      const key = String(c.code || '').toUpperCase().trim();
      if (key) liveUsedByCode.set(key, Number(c.usedCount) || 0);
    }

    // Preserve usedCount in this order:
    //   1. Whatever the caller sent (already validated and round-trippable).
    //   2. Live DB value for the same code (defensive — handles legacy
    //      clients that don't send usedCount at all).
    //   3. Zero (new coupon never used).
    const couponsWithUsedCount = body.coupons.map((c) => {
      if (c.usedCount != null) return c;
      const key = String(c.code || '').toUpperCase().trim();
      if (liveUsedByCode.has(key)) {
        return { ...c, usedCount: liveUsedByCode.get(key) };
      }
      return c; // normaliseCoupons defaults to 0
    });

    data.coupons = normaliseCoupons(couponsWithUsedCount);
  }

  const plan = await repo.updateInternalPlan(id, data);

  logger.info({ msg: 'internal_plan_updated', traceId, plan_id: id });

  return plan;
}

// ---------------------------------------------------------------------------
// setInternalPlanStatus
// ---------------------------------------------------------------------------

/**
 * @param {number} id
 * @param {'ACTIVE'|'INACTIVE'} status
 * @param {string} traceId
 * @returns {Promise<object>}
 */
async function setInternalPlanStatus(id, status, traceId) {
  await getInternalPlanById(id, traceId);
  const plan = await repo.updateInternalPlan(id, { status });
  logger.info({ msg: 'internal_plan_status_set', traceId, plan_id: id, status });
  return plan;
}

// ---------------------------------------------------------------------------
// deleteInternalPlan
// ---------------------------------------------------------------------------

/**
 * @param {number} id
 * @param {string} traceId
 * @returns {Promise<void>}
 */
async function deleteInternalPlan(id, traceId) {
  await getInternalPlanById(id, traceId);
  await repo.deleteInternalPlan(id);
  logger.info({ msg: 'internal_plan_deleted', traceId, plan_id: id });
}

// ---------------------------------------------------------------------------
// listByCourse
// ---------------------------------------------------------------------------

/**
 * @param {number} courseId
 * @param {string} traceId
 * @returns {Promise<object[]>}
 */
async function listByCourse(courseId, traceId) {
  const plans = await repo.findActivePlansByCourse(Number(courseId));
  logger.info({ msg: 'internal_plan_list_by_course', traceId, courseId, count: plans.length });
  return plans;
}

// ---------------------------------------------------------------------------
// validateCoupon
// ---------------------------------------------------------------------------

/**
 * @param {{ code: string, internalPlanId: number, basePrice: number }} params
 * @param {string} traceId
 * @returns {Promise<object>}
 */
async function validateCoupon({ code, internalPlanId, basePrice }, traceId) {
  const plan = await repo.findInternalPlanById(Number(internalPlanId));

  if (!plan) {
    return { valid: false, discountAmount: 0, finalAmount: 0, reason: 'Plan not found' };
  }

  const result = runCouponValidation({ code, plan, basePrice });
  logger.info({
    msg: 'internal_plan_coupon_validated',
    traceId,
    plan_id: internalPlanId,
    code,
    valid: result.valid,
  });

  return result;
}

// ---------------------------------------------------------------------------
// calculateFee
// ---------------------------------------------------------------------------

/**
 * @param {{ internalPlanId: number, basePrice: number, couponCode?: string }} params
 * @param {string} traceId
 * @returns {Promise<object>}
 */
async function calculateFee({ internalPlanId, basePrice, couponCode }, traceId) {
  const plan = await repo.findInternalPlanById(Number(internalPlanId));

  if (!plan) {
    throw ApiError.notFound(`Internal plan ${internalPlanId} not found`);
  }

  const price = Number(basePrice);

  if (!couponCode) {
    return {
      basePrice:   price,
      discount:    0,
      finalAmount: price,
      breakdown: [
        { label: 'Base Price', amount: price },
        { label: 'Discount',   amount: 0 },
        { label: 'Total',      amount: price },
      ],
    };
  }

  const result = runCouponValidation({ code: couponCode, plan, basePrice: price });

  if (!result.valid) {
    return {
      basePrice:    price,
      discount:     0,
      finalAmount:  price,
      couponValid:  false,
      couponReason: result.reason,
      breakdown: [
        { label: 'Base Price', amount: price },
        { label: 'Discount',   amount: 0 },
        { label: 'Total',      amount: price },
      ],
    };
  }

  return {
    basePrice:   price,
    discount:    result.discountAmount,
    finalAmount: result.finalAmount,
    couponValid: true,
    breakdown: [
      { label: 'Base Price',                                 amount: price },
      { label: `Coupon (${couponCode.toUpperCase()})`,       amount: -result.discountAmount },
      { label: 'Total',                                      amount: result.finalAmount },
    ],
  };
}

module.exports = {
  listInternalPlans,
  getInternalPlanById,
  createInternalPlan,
  updateInternalPlan,
  setInternalPlanStatus,
  deleteInternalPlan,
  listByCourse,
  validateCoupon,
  calculateFee,
  // Exported so the admin internal-enrollment service can re-run the
  // EXACT same validation logic the public calculate-fee endpoint uses
  // — including the usage-limit check, which the admin path enforces.
  runCouponValidation,
};
