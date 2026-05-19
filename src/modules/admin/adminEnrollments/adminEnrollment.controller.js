'use strict';

const enrollmentService = require('../../enrollments/enrollment.service');
const { getPrismaClient } = require('../../../config/database');
const ApiError = require('../../../utils/ApiError');
const { sendSuccess } = require('../../../utils/ApiResponse');
const asyncHandler = require('../../../utils/asyncHandler');
const { HTTP } = require('../../../config/constants');
const { mapEnrollmentStatus } = require('../../../utils/transformAdmin');

/**
 * GET /api/v1/admin/enrollments
 *
 * Paginated, searchable list of all enrollments. Transforms snake_case
 * DB rows into camelCase. Also forwards the per-enrollment financial
 * snapshot fields (basePricePaise, discountAmountPaise,
 * finalAmountPaise, amountPaidPaise, pendingPaise, couponCode,
 * internalPaymentStatus, internalPlanId) so the new InternalEnrollments
 * admin page can render the breakdown columns without an extra fetch.
 *
 * For non-internal (public-website) rows those fields stay null —
 * the frontend renders "—" for them.
 */
const list = asyncHandler(async (req, res) => {
  const { rows, meta } = await enrollmentService.listEnrollments(req.query, req.traceId);

  const items = rows.map((r) => ({
    id:           r.id,
    enrollmentId: r.enrollment_code || r.id,
    fullName:
      r.name ||
      [`${r.first_name || ''}`.trim(), `${r.last_name || ''}`.trim()]
        .filter(Boolean)
        .join(' ') ||
      null,
    firstName:  r.first_name  || null,
    lastName:   r.last_name   || null,
    email:      r.email,
    phone:      r.phone_number || null,
    role:       r.user_role   || null,
    education:  r.education   || null,
    readiness:  r.readiness   || null,
    source:     r.source      || null,
    candidateType: r.candidate_type || 'EXTERNAL',
    status:     mapEnrollmentStatus(r.status),
    createdAt:  r.created_at,
    updatedAt:  r.updated_at,
    // Financial snapshot (null for non-internal rows)
    internalPlanId:        r.internal_plan_id        ?? null,
    basePricePaise:        r.base_price_paise        ?? null,
    discountAmountPaise:   r.discount_amount_paise   ?? null,
    finalAmountPaise:      r.final_amount_paise      ?? null,
    amountPaidPaise:       r.amount_paid_paise       ?? null,
    pendingPaise: (r.final_amount_paise != null && r.amount_paid_paise != null)
      ? Math.max(0, r.final_amount_paise - r.amount_paid_paise)
      : null,
    couponCode:            r.coupon_code_snapshot     ?? null,
    internalPaymentStatus: r.internal_payment_status  ?? null,
  }));

  sendSuccess(res, HTTP.OK, {
    items,
    total:      meta.total,
    page:       meta.page,
    limit:      meta.limit,
    totalPages: meta.totalPages,
  });
});

/**
 * GET /api/v1/admin/enrollments/:id
 *
 * Returns one enrollment + its internal plan + course + ALL Payment rows
 * for the detail drawer / payment history section. Uses a single Prisma
 * round-trip with the include tree so the frontend doesn't have to chain
 * requests.
 *
 * For public-website enrollments the `internalPlan` field is null and the
 * snapshot fields render as null — the drawer shows a notice that the
 * detailed financial breakdown only applies to internal-flow enrollments.
 */
const getById = asyncHandler(async (req, res) => {
  const db = getPrismaClient();
  const e = await db.enrollment.findFirst({
    where: { id: req.params.id, deleted_at: null },
    include: {
      internal_plan: { include: { course: true } },
      payments:      { orderBy: { created_at: 'desc' } },
    },
  });
  if (!e) throw ApiError.notFound('Enrollment not found');

  const finalPaise   = e.final_amount_paise;
  const paidPaise    = e.amount_paid_paise ?? 0;
  const pendingPaise = (finalPaise != null) ? Math.max(0, finalPaise - paidPaise) : null;

  // Serialise the coupon snapshot to a plain object so frontend code
  // can destructure without worrying about Prisma's JSON wrappers.
  const couponSnapshot = e.coupon_snapshot
    ? JSON.parse(JSON.stringify(e.coupon_snapshot))
    : null;

  sendSuccess(res, HTTP.OK, {
    id:            e.id,
    enrollmentId:  e.enrollment_code || e.id,
    fullName:
      e.name ||
      [`${e.first_name || ''}`.trim(), `${e.last_name || ''}`.trim()]
        .filter(Boolean).join(' ') || null,
    firstName:     e.first_name || null,
    lastName:      e.last_name  || null,
    email:         e.email,
    phone:         e.phone_number || null,
    role:          e.user_role   || null,
    education:     e.education   || null,
    readiness:     e.readiness   || null,
    source:        e.source      || null,
    candidateType: e.candidate_type || 'EXTERNAL',
    status:        mapEnrollmentStatus(e.status),
    createdAt:     e.created_at,
    updatedAt:     e.updated_at,

    internalPlan: e.internal_plan
      ? {
          id:       e.internal_plan.id,
          refId:    e.internal_plan.refId,
          name:     e.internal_plan.name,
          duration: e.internal_plan.duration,
          course: e.internal_plan.course
            ? {
                id:   e.internal_plan.course.id,
                name: e.internal_plan.course.nameOfCourseAsGroup,
                fee:  Number(e.internal_plan.course.courseFee),
              }
            : null,
        }
      : null,

    basePricePaise:        e.base_price_paise        ?? null,
    discountAmountPaise:   e.discount_amount_paise   ?? null,
    finalAmountPaise:      finalPaise                ?? null,
    amountPaidPaise:       paidPaise,
    pendingPaise,
    couponCode:            e.coupon_code_snapshot     ?? null,
    couponSnapshot,
    internalPaymentStatus: e.internal_payment_status  ?? null,

    payments: (e.payments ?? []).map((p) => ({
      id:                p.id,
      amountPaise:       p.amount,
      currency:          p.currency,
      status:            p.status,
      razorpayOrderId:   p.razorpay_order_id,
      razorpayPaymentId: p.razorpay_payment_id || null,
      // Mode hint: synthetic ADMIN_MANUAL_<uuid> ids indicate the
      // admin-internal flow created the Payment row; everything else
      // is a real Razorpay order from the public website.
      mode: p.razorpay_order_id?.startsWith('ADMIN_MANUAL_')
        ? 'ADMIN_MANUAL'
        : 'RAZORPAY',
      collectedBy: null, // future: populate when a record-payment UI exists
      createdAt:   p.created_at,
      updatedAt:   p.updated_at,
    })),
  });
});

module.exports = { list, getById };
