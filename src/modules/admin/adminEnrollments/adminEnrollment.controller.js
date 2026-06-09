'use strict';

const { Prisma } = require('@prisma/client');
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
          externalPlanId: e.internal_plan.externalPlanId ?? null,
          // Real duration derived from the Plan ID (e.g. 30 Days / 3 Months);
          // falls back to the legacy enum label when the code has no token.
          durationLabel:  internalDurationLabel(e.internal_plan),
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
 * GET /api/v1/admin/enrollments/internal-grouped
 *
 * One row PER EMAIL for admin-internal enrollments — the most recent enrollment
 * for each email, plus `enrollmentCount` (how many internal enrollments that
 * email has). Powers the Internal Enrollments page, where each student appears
 * once and a row/email click drills into the full per-email history.
 *
 * Server-side grouping (DISTINCT ON via window functions) so dedup is global,
 * not per-page. Supports the same fromDate/toDate filters and pagination as the
 * flat list. Pagination is over distinct emails.
 */
const internalGrouped = asyncHandler(async (req, res) => {
  const db = getPrismaClient();
  const page  = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const offset = (page - 1) * limit;

  const from = req.query.fromDate ? new Date(req.query.fromDate) : null;
  const to   = req.query.toDate   ? new Date(req.query.toDate)   : null;

  const conds = [
    Prisma.sql`deleted_at IS NULL`,
    Prisma.sql`candidate_type = 'INTERNAL'`,
  ];
  if (from && !Number.isNaN(from.getTime())) conds.push(Prisma.sql`created_at >= ${from}`);
  if (to   && !Number.isNaN(to.getTime()))   conds.push(Prisma.sql`created_at <= ${to}`);
  const where = Prisma.join(conds, ' AND ');

  const rows = await db.$queryRaw`
    WITH internal AS (
      SELECT * FROM "enrollments" WHERE ${where}
    ), ranked AS (
      SELECT *,
        ROW_NUMBER() OVER (PARTITION BY lower(email) ORDER BY created_at DESC) AS rn,
        COUNT(*)     OVER (PARTITION BY lower(email))::int AS email_count
      FROM internal
    )
    SELECT id, enrollment_code, name, first_name, last_name, email, phone_number,
           status, internal_payment_status, internal_plan_id, candidate_type,
           created_at, updated_at, email_count
    FROM ranked
    WHERE rn = 1
    ORDER BY created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;

  const totalRows = await db.$queryRaw`
    SELECT COUNT(DISTINCT lower(email))::int AS total
    FROM "enrollments" WHERE ${where}
  `;
  const total = totalRows?.[0]?.total ?? 0;

  // Active plan per email = the student's LATEST PAID enrollment's plan, so this
  // page can show the same "Active Plan" (Plan ID + days left) column as the
  // main Enrollments page. For internal rows the Plan ID is the internal plan's
  // externalPlanId (configured on /admin/internal-plans). Mirrors groupedByEmail.
  const activeByEmail = new Map();
  const emailsForActive = rows.map((r) => r.email).filter(Boolean);
  if (emailsForActive.length > 0) {
    const paidRows = await db.enrollment.findMany({
      where: {
        email:      { in: emailsForActive },
        deleted_at: null,
        status:     { in: ACTIVE_PLAN_STATUSES },
      },
      orderBy: { created_at: 'desc' },
      include: {
        plan_pricing:  { include: { plan: true } },
        internal_plan: { select: { name: true, duration: true, externalPlanId: true } },
        payments:      { select: { status: true, created_at: true } },
      },
    });
    for (const pr of paidRows) {
      const key = String(pr.email).toLowerCase();
      if (activeByEmail.has(key)) continue; // first hit = latest (orderBy desc)
      const win = computePlanWindow(pr);
      activeByEmail.set(key, {
        externalPlanId: pr.internal_plan?.externalPlanId || pr.plan_pricing?.externalPlanId || null,
        planLabel:      pr.internal_plan?.name || pr.plan_pricing?.plan?.name || null,
        daysLeft:       win.daysLeft,
        planExpiryAt:   win.planExpiryAt,
      });
    }
  }

  const items = rows.map((r) => ({
    id:           r.id,
    enrollmentId: r.enrollment_code || r.id,
    fullName:
      r.name ||
      [`${r.first_name || ''}`.trim(), `${r.last_name || ''}`.trim()]
        .filter(Boolean).join(' ') || null,
    email:                 r.email,
    phone:                 r.phone_number || null,
    status:                mapEnrollmentStatus(r.status),
    internalPaymentStatus: r.internal_payment_status ?? null,
    internalPlanId:        r.internal_plan_id ?? null,
    candidateType:         r.candidate_type || 'INTERNAL',
    enrollmentCount:       r.email_count ?? 1,
    createdAt:             r.created_at,
    updatedAt:             r.updated_at,
    // Latest-paid plan for this student (Plan ID + remaining days); null when none.
    activePlan: activeByEmail.get(String(r.email).toLowerCase()) || null,
  }));

  sendSuccess(res, HTTP.OK, {
    items,
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  });
});

/**
 * GET /api/v1/admin/enrollments/grouped
 *
 * One row PER EMAIL across ALL enrollments (internal + external) — the most
 * recent enrollment for each email plus `enrollmentCount`. Mirrors the flat
 * list's filters (search / candidateType / status / externalSyncStatus /
 * date range) and item shape (incl. the lastSync diagnostic) so the
 * Enrollments page can render its Sync column and Retry button against the
 * representative (latest) row. Filters apply BEFORE grouping, so the "latest"
 * row is the latest one matching the filter. Pagination is over distinct emails.
 */
const groupedByEmail = asyncHandler(async (req, res) => {
  const db = getPrismaClient();
  const page  = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const offset = (page - 1) * limit;

  const conds = [Prisma.sql`deleted_at IS NULL`];

  const search = String(req.query.search || '').trim();
  if (search) {
    const like = `%${search}%`;
    conds.push(Prisma.sql`(name ILIKE ${like} OR email ILIKE ${like} OR phone_number ILIKE ${like} OR first_name ILIKE ${like} OR last_name ILIKE ${like})`);
  }
  const ctype = req.query.candidateType;
  if (ctype === 'INTERNAL' || ctype === 'EXTERNAL') {
    conds.push(Prisma.sql`candidate_type::text = ${ctype}`);
  }
  if (req.query.status) {
    conds.push(Prisma.sql`status::text = ${String(req.query.status)}`);
  }
  if (req.query.externalSyncStatus) {
    conds.push(Prisma.sql`external_sync_status::text = ${String(req.query.externalSyncStatus)}`);
  }
  const from = req.query.fromDate ? new Date(req.query.fromDate) : null;
  const to   = req.query.toDate   ? new Date(req.query.toDate)   : null;
  if (from && !Number.isNaN(from.getTime())) conds.push(Prisma.sql`created_at >= ${from}`);
  if (to   && !Number.isNaN(to.getTime()))   conds.push(Prisma.sql`created_at <= ${to}`);
  const where = Prisma.join(conds, ' AND ');

  const rows = await db.$queryRaw`
    WITH filtered AS (
      SELECT * FROM "enrollments" WHERE ${where}
    ), ranked AS (
      SELECT *,
        ROW_NUMBER() OVER (PARTITION BY lower(email) ORDER BY created_at DESC) AS rn,
        COUNT(*)     OVER (PARTITION BY lower(email))::int AS email_count
      FROM filtered
    )
    SELECT * FROM ranked WHERE rn = 1
    ORDER BY created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
  const totalRows = await db.$queryRaw`
    SELECT COUNT(DISTINCT lower(email))::int AS total FROM "enrollments" WHERE ${where}
  `;
  const total = totalRows?.[0]?.total ?? 0;

  // Enrich each representative row with its latest external_api_log (Sync col).
  const ids = rows.map((r) => r.id);
  const logByEnrollment = new Map();
  if (ids.length > 0) {
    const logs = await db.externalApiLog.findMany({
      where:   { enrollment_id: { in: ids } },
      orderBy: { created_at: 'desc' },
      select: {
        enrollment_id: true, status: true, attempts: true, last_error: true,
        status_code: true, endpoint: true, created_at: true, updated_at: true,
      },
    });
    for (const log of logs) {
      if (!logByEnrollment.has(log.enrollment_id)) logByEnrollment.set(log.enrollment_id, log);
    }
  }

  // Active plan per email = the student's LATEST PAID enrollment's plan. Drives
  // the "Active Plan" column on the Enrollments page (Plan ID + days left).
  // Resolved independently of the representative row, which may be an unpaid
  // draft (e.g. an upgrade just started).
  const activeByEmail = new Map();
  const emailsForActive = rows.map((r) => r.email).filter(Boolean);
  if (emailsForActive.length > 0) {
    const paidRows = await db.enrollment.findMany({
      where: {
        email:      { in: emailsForActive },
        deleted_at: null,
        status:     { in: ACTIVE_PLAN_STATUSES },
      },
      orderBy: { created_at: 'desc' },
      include: {
        plan_pricing:  { include: { plan: true } },
        internal_plan: { select: { name: true, duration: true, externalPlanId: true } },
        payments:      { select: { status: true, created_at: true } },
      },
    });
    for (const pr of paidRows) {
      const key = String(pr.email).toLowerCase();
      if (activeByEmail.has(key)) continue; // first hit = latest (orderBy desc)
      const win = computePlanWindow(pr);
      activeByEmail.set(key, {
        externalPlanId: pr.internal_plan?.externalPlanId || pr.plan_pricing?.externalPlanId || null,
        planLabel:      pr.internal_plan?.name || pr.plan_pricing?.plan?.name || null,
        daysLeft:       win.daysLeft,
        planExpiryAt:   win.planExpiryAt,
      });
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
          .filter(Boolean).join(' ') || null,
      firstName:     r.first_name || null,
      lastName:      r.last_name  || null,
      email:         r.email,
      phone:         r.phone_number || null,
      role:          r.user_role || null,
      education:     r.education || null,
      readiness:     r.readiness || null,
      source:        r.source || null,
      candidateType: r.candidate_type || 'EXTERNAL',
      status:        mapEnrollmentStatus(r.status),
      createdAt:     r.created_at,
      updatedAt:     r.updated_at,
      internalPlanId:        r.internal_plan_id ?? null,
      internalPaymentStatus: r.internal_payment_status ?? null,
      externalSyncStatus:    r.external_sync_status ?? null,
      enrollmentCount:       r.email_count ?? 1,
      // Latest-paid plan for this student (Plan ID + remaining days). Null when
      // the student has no paid plan yet.
      activePlan: activeByEmail.get(String(r.email).toLowerCase()) || null,
      lastSync: log
        ? {
            logStatus:   log.status,
            attempts:    log.attempts,
            error:       log.last_error,
            statusCode:  log.status_code,
            endpoint:    log.endpoint,
            attemptedAt: log.updated_at || log.created_at,
          }
        : null,
    };
  });

  const totalPages = Math.max(1, Math.ceil(total / limit));
  sendSuccess(res, HTTP.OK, {
    items, total, page, limit, totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  });
});

// Statuses for which a plan is considered "active" — i.e. the student has paid
// and a validity window should be computed. Unpaid / terminal rows have no
// running plan and therefore no days-left.
const ACTIVE_PLAN_STATUSES = ['paid', 'completed', 'sync_pending'];

// Internal plans carry no real duration column — the form hardcodes the enum
// (always 6_MONTHS), so it can't be trusted. The Plan ID code is the source of
// truth (e.g. ..._30DAYS / ..._3MONTHS). Shared helpers live in utils so the
// Sumago mirror sync resolves durations identically. See utils/planDuration.js.
const {
  INTERNAL_DURATION_MONTHS,
  parseDurationFromPlanId,
  internalDurationLabel,
} = require('../../../utils/planDuration');

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Resolve an enrollment's plan validity window.
 *
 * Start = the most recent successful payment date (the moment the plan was
 * actually paid for), falling back to updated_at (when the row was settled)
 * then created_at. End = start + duration, computed with real calendar math
 * (month-aware, not 30-day approximation). daysLeft is ceil()-ed so a plan
 * that ends later today still reads as "1 day left", and goes negative once
 * expired.
 *
 * Returns all-null when the enrollment isn't on an active (paid) plan or the
 * plan has no resolvable duration — the frontend renders "—" in that case.
 *
 * @param {object} e — enrollment row with plan_pricing + internal_plan + payments
 * @returns {{ durationLabel: string|null, planStartAt: Date|null, planExpiryAt: Date|null, daysLeft: number|null }}
 */
function computePlanWindow(e) {
  const empty = { durationLabel: null, planStartAt: null, planExpiryAt: null, daysLeft: null };
  if (!ACTIVE_PLAN_STATUSES.includes(e.status)) return empty;

  // Resolve duration value + unit from whichever plan type this row carries.
  let value = null;
  let unit = 'MONTHS';
  if (e.internal_plan) {
    // Internal plans: derive the real duration from the Plan ID code
    // (e.g. ..._30DAYS / ..._3MONTHS); fall back to the legacy enum when the
    // code carries no duration token.
    const parsed = parseDurationFromPlanId(e.internal_plan.externalPlanId);
    if (parsed) {
      value = parsed.value;
      unit  = parsed.unit;
    } else if (e.internal_plan.duration != null) {
      value = INTERNAL_DURATION_MONTHS[e.internal_plan.duration] ?? null;
      unit  = 'MONTHS';
    }
  } else if (e.plan_pricing?.durationMonths != null) {
    value = Number(e.plan_pricing.durationMonths);
    unit = String(e.plan_pricing.durationUnit || 'MONTHS').toUpperCase() === 'DAYS' ? 'DAYS' : 'MONTHS';
  }
  if (value == null || !Number.isFinite(value) || value <= 0) return empty;

  // Start = latest successful payment, else settlement/creation timestamp.
  const successPayments = (e.payments || []).filter((p) => p.status === 'success' && p.created_at);
  const latestPaymentAt = successPayments.length
    ? successPayments.reduce((max, p) => (p.created_at > max ? p.created_at : max), successPayments[0].created_at)
    : null;
  const startAt = new Date(latestPaymentAt || e.updated_at || e.created_at);

  const expiry = new Date(startAt);
  if (unit === 'DAYS') expiry.setUTCDate(expiry.getUTCDate() + value);
  else expiry.setUTCMonth(expiry.getUTCMonth() + value);

  const daysLeft = Math.ceil((expiry.getTime() - Date.now()) / MS_PER_DAY);
  const durationLabel = unit === 'DAYS'
    ? `${value} day${value === 1 ? '' : 's'}`
    : `${value} month${value === 1 ? '' : 's'}`;

  return { durationLabel, planStartAt: startAt, planExpiryAt: expiry, daysLeft };
}

/**
 * GET /api/v1/admin/enrollments/by-email?email=...
 *
 * Returns every (non-deleted) enrollment that shares an email, newest first,
 * as a compact history list. Powers the grouped-by-email history surfaces:
 * the detail drawer's "other enrollments", the grouped list rows, the
 * dedicated student-history page, and the plan-enrollments page.
 *
 * Case-insensitive match on email. Each item carries a plan label, status,
 * amount, timestamps, and the plan validity window (planStartAt /
 * planExpiryAt / daysLeft) so the frontend can show "days left on plan"
 * without an extra fetch per row.
 */
const historyByEmail = asyncHandler(async (req, res) => {
  const email = String(req.query.email || '').trim();
  if (!email) throw ApiError.badRequest('email query parameter is required');

  const db = getPrismaClient();

  // Server-side pagination. Defaults: page 1, 10 rows; limit capped at 100.
  const page  = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 10));
  const skip  = (page - 1) * limit;

  const where = { email: { equals: email, mode: 'insensitive' }, deleted_at: null };
  const include = {
    plan_pricing:  { include: { plan: true } },
    internal_plan: { select: { id: true, name: true, duration: true, externalPlanId: true } },
    payments:      { select: { amount: true, status: true, created_at: true } },
  };

  const [total, rows] = await Promise.all([
    db.enrollment.count({ where }),
    db.enrollment.findMany({
      where,
      orderBy: { created_at: 'desc' },
      skip,
      take: limit,
      include,
    }),
  ]);

  const items = rows.map((e) => {
    // Plan label: internal plan name, else external plan name + duration.
    let planLabel = e.internal_plan?.name || null;
    if (!planLabel && e.plan_pricing?.plan?.name) {
      const months = e.plan_pricing.durationMonths;
      const unit = String(e.plan_pricing.durationUnit || 'MONTHS').toUpperCase() === 'DAYS' ? 'days' : 'mo';
      planLabel = months != null
        ? `${e.plan_pricing.plan.name} · ${months} ${unit}`
        : e.plan_pricing.plan.name;
    }
    const paidPaise = (e.payments || [])
      .filter((p) => p.status === 'success')
      .reduce((s, p) => s + (p.amount || 0), 0);

    const { durationLabel, planStartAt, planExpiryAt, daysLeft } = computePlanWindow(e);

    return {
      id:            e.id,
      enrollmentId:  e.enrollment_code || e.id,
      fullName:
        e.name ||
        [`${e.first_name || ''}`.trim(), `${e.last_name || ''}`.trim()]
          .filter(Boolean).join(' ') || null,
      email:         e.email,
      phone:         e.phone_number || null,
      status:        mapEnrollmentStatus(e.status),
      candidateType: e.candidate_type || 'EXTERNAL',
      source:        e.source || null,
      planLabel,
      // Plan ID = the external_plan_id of the plan the student bought (the
      // "Plan ID" column on the plan-details page). Identifies the exact plan.
      externalPlanId: e.internal_plan?.externalPlanId || e.plan_pricing?.externalPlanId || null,
      amountPaise:     e.final_amount_paise ?? e.amount ?? null,
      // Prefer the sum of SUCCESSFUL payments (public/upgrade flow records the
      // money there, leaving amount_paid_paise at its 0 default); fall back to
      // the internal-flow snapshot column when no success payment row exists.
      amountPaidPaise: paidPaise > 0 ? paidPaise : (e.amount_paid_paise ?? null),
      // Plan validity window — null for unpaid / no-duration rows.
      durationLabel,
      planStartAt,
      planExpiryAt,
      daysLeft,
      createdAt:     e.created_at,
      updatedAt:     e.updated_at,
    };
  });

  // Current active plan — the most recent active-plan enrollment for this email,
  // resolved INDEPENDENTLY of the current page so the "Current Plan / days left"
  // summary card stays correct even when the admin is on page 2+.
  const currentRow = await db.enrollment.findFirst({
    where: { ...where, status: { in: ACTIVE_PLAN_STATUSES } },
    orderBy: { created_at: 'desc' },
    include,
  });
  let currentPlan = null;
  if (currentRow) {
    const win = computePlanWindow(currentRow);
    if (win.daysLeft != null) {
      let planLabel = currentRow.internal_plan?.name || null;
      if (!planLabel && currentRow.plan_pricing?.plan?.name) {
        const months = currentRow.plan_pricing.durationMonths;
        const unit = String(currentRow.plan_pricing.durationUnit || 'MONTHS').toUpperCase() === 'DAYS' ? 'days' : 'mo';
        planLabel = months != null
          ? `${currentRow.plan_pricing.plan.name} · ${months} ${unit}`
          : currentRow.plan_pricing.plan.name;
      }
      currentPlan = {
        enrollmentId: currentRow.enrollment_code || currentRow.id,
        externalPlanId: currentRow.internal_plan?.externalPlanId || currentRow.plan_pricing?.externalPlanId || null,
        planLabel,
        ...win,
      };
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / limit));
  sendSuccess(res, HTTP.OK, {
    email,
    items,
    total,
    page,
    limit,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
    currentPlan,
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

module.exports = { list, getById, internalGrouped, groupedByEmail, historyByEmail, retrySync };
