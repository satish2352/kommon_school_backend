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

  // ─── Batch-fetch the latest external_api_log per enrollment ────────
  // The admin Enrollments page renders a per-row "why did sync fail?"
  // tooltip on the Sync column. Without this enrichment, admins would
  // have to open backend logs to diagnose failures.
  //
  // Implementation: O(N) — one batched findMany over the page's
  // enrollment IDs (≤100 by pagination), then a single-pass dedupe in
  // JS keeping the most-recent row per enrollment. Cheaper than a
  // correlated subquery at this page size, and avoids the N+1 fan-out.
  const db = getPrismaClient();
  const enrollmentIds = rows.map((r) => r.id);
  const logByEnrollment = new Map();
  if (enrollmentIds.length > 0) {
    const logs = await db.externalApiLog.findMany({
      where:   { enrollment_id: { in: enrollmentIds } },
      orderBy: { created_at: 'desc' },
      select: {
        enrollment_id: true,
        status:        true,
        attempts:      true,
        last_error:    true,
        status_code:   true,
        endpoint:      true,
        created_at:    true,
        updated_at:    true,
      },
    });
    for (const log of logs) {
      if (!logByEnrollment.has(log.enrollment_id)) {
        logByEnrollment.set(log.enrollment_id, log);
      }
    }
  }

  const items = rows.map((r) => {
    const log = logByEnrollment.get(r.id) || null;
    return {
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
      // Third-party sync state — separate from `status`. NULL on legacy
      // rows that pre-date the column; admin UI renders it as "—".
      externalSyncStatus:    r.external_sync_status     ?? null,
      // Diagnostic snapshot from the latest external_api_log row so the
      // admin UI can show *why* sync failed without opening backend logs.
      // All fields are null when no log exists yet (e.g. rows before
      // payment, or legacy rows from before the column existed).
      lastSync: log
        ? {
            logStatus:    log.status,         // retrying | failed | dead_letter | success
            attempts:     log.attempts,
            error:        log.last_error,
            statusCode:   log.status_code,
            endpoint:     log.endpoint,
            attemptedAt:  log.updated_at || log.created_at,
          }
        : null,
    };
  });

  sendSuccess(res, HTTP.OK, {
    items,
    // Full pagination metadata. `hasNext` / `hasPrev` let the frontend
    // drive its Prev/Next buttons without falling back to the
    // `items.length === limit` heuristic (which is wrong on the last
    // exactly-full page).
    total:      meta.total,
    page:       meta.page,
    limit:      meta.limit,
    totalPages: meta.totalPages,
    hasNext:    meta.hasNext,
    hasPrev:    meta.hasPrev,
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
      internal_plan:     { include: { course: true } },
      payments:          { orderBy: { created_at: 'desc' } },
      // Last 20 sync attempts — drives the "Sync history" section of the
      // detail drawer. 20 is generous; typical enrollments have <5 rows.
      external_api_logs: { orderBy: { created_at: 'desc' }, take: 20 },
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
    externalSyncStatus:    e.external_sync_status     ?? null,

    // Full sync history — newest first, last 20 attempts. Powers the
    // "Sync history" timeline in the detail drawer.
    syncLogs: (e.external_api_logs ?? []).map((l) => ({
      id:          l.id,
      status:      l.status,
      attempts:    l.attempts,
      error:       l.last_error,
      statusCode:  l.status_code,
      endpoint:    l.endpoint,
      durationMs:  l.duration_ms,
      attemptedAt: l.updated_at || l.created_at,
      createdAt:   l.created_at,
    })),

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

/**
 * POST /api/v1/admin/enrollments/:id/retry-sync
 *
 * Re-queue the external-API sync job for an enrollment whose
 * `external_sync_status` is FAILED or DEAD_LETTER. Used by the admin
 * "Retry sync" button after a root-cause fix (e.g., refreshed webhook URL).
 *
 * Steps:
 *   1. Verify the enrollment exists and was actually paid (latest payment
 *      row in `success` status). Otherwise refuse — we should never push
 *      an unpaid enrollment to the external system.
 *   2. Flip external_sync_status → PENDING so the UI immediately reflects
 *      the in-flight state.
 *   3. Re-promote the most recent log row from `dead_letter`/`failed` →
 *      `retrying` so the auto-retry sweeper and the worker treat it as live.
 *   4. Enqueue a fresh BullMQ job with a UUID-prefixed jobId so it never
 *      collides with the original (which may still be in completed/failed).
 *
 * Returns the enrollment's updated external_sync_status + the BullMQ job id
 * for ops correlation.
 */
const retrySync = asyncHandler(async (req, res) => {
  const db = getPrismaClient();
  const enrollmentId = req.params.id;

  const enrollment = await db.enrollment.findFirst({
    where: { id: enrollmentId, deleted_at: null },
    include: {
      payments: {
        where:   { status: 'success' },
        orderBy: { created_at: 'desc' },
        take:    1,
      },
    },
  });
  if (!enrollment) throw ApiError.notFound('Enrollment not found');

  const successfulPayment = enrollment.payments[0] || null;
  if (!successfulPayment && enrollment.amount_paid_paise === 0) {
    // Allow ADMIN_MANUAL / FULLY_DISCOUNTED rows (no Razorpay payment but
    // legitimately "paid") — those have amount_paid_paise > 0 OR
    // internal_payment_status set. Block only rows with neither signal.
    if (!enrollment.internal_payment_status) {
      throw ApiError.badRequest(
        'Cannot retry sync for an enrollment with no successful payment',
      );
    }
  }

  // Flip enrollment to PENDING so the UI reflects "retry in flight".
  await db.enrollment.update({
    where: { id: enrollmentId },
    data:  { external_sync_status: 'PENDING' },
  });

  // Re-promote the most recent log row so the sweeper/worker treat it as
  // live again. If no log exists at all (shouldn't happen post-payment but
  // defensive), the worker will create one on its first attempt.
  const externalRepo = require('../../externalApi/external.repository');
  const lastLog = await externalRepo.findLatestLogForEnrollment(enrollmentId);
  if (lastLog) {
    await db.externalApiLog.update({
      where: { id: lastLog.id },
      data:  {
        status:          'retrying',
        next_attempt_at: new Date(),
      },
    });
  }

  const { enqueueExternalApiRetry } = require('../../../queues/externalApi.queue');
  const job = await enqueueExternalApiRetry({
    enrollmentId,
    paymentId: successfulPayment ? successfulPayment.id : undefined,
    traceId:   req.traceId,
  });

  sendSuccess(res, HTTP.OK, {
    enrollmentId,
    externalSyncStatus: 'PENDING',
    jobId:              job.id,
  }, 'Retry queued');
});

module.exports = { list, getById, retrySync };
