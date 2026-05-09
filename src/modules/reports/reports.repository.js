'use strict';

const { getPrismaClient } = require('../../config/database');
const { Prisma } = require('@prisma/client');

function getDb() {
  return getPrismaClient();
}

// All 7 EnrollmentStatus values in display order
const ALL_ENROLLMENT_STATUSES = [
  'submitted',
  'payment_pending',
  'paid',
  'sync_pending',
  'completed',
  'failed',
  'expired',
];

// All 6 ExternalApiStatus values
const ALL_EXTERNAL_API_STATUSES = [
  'pending',
  'processing',
  'success',
  'failed',
  'retrying',
  'dead_letter',
];

/**
 * Build a safe Prisma.sql WHERE fragment for created_at date range filtering.
 * Returns Prisma.empty() when no dates are provided so it can be safely
 * interpolated into a Prisma.sql template.
 *
 * @param {Date|undefined} dateFrom
 * @param {Date|undefined} dateTo
 * @returns {Prisma.Sql}
 */
function buildDateFilter(dateFrom, dateTo) {
  if (dateFrom && dateTo) {
    return Prisma.sql`AND created_at BETWEEN ${dateFrom} AND ${dateTo}`;
  }
  if (dateFrom) {
    return Prisma.sql`AND created_at >= ${dateFrom}`;
  }
  if (dateTo) {
    return Prisma.sql`AND created_at <= ${dateTo}`;
  }
  return Prisma.empty;
}

/**
 * Aggregated payments summary.
 * Returns total count across all statuses; total_amount_paise only for
 * success payments (matches business expectation for settled revenue).
 * Groups by status so callers can build breakdowns.
 *
 * @param {{ dateFrom?: Date, dateTo?: Date }} opts
 * @returns {Promise<{ total_count: number, total_amount_paise: number, by_status: Array<{ status: string, count: number, amount_paise: number }> }>}
 */
async function getPaymentsSummary({ dateFrom, dateTo } = {}) {
  const dateFilter = buildDateFilter(dateFrom, dateTo);

  const rows = await getDb().$queryRaw`
    SELECT
      status::text            AS status,
      COUNT(*)::int           AS count,
      COALESCE(SUM(amount), 0)::bigint AS amount_paise
    FROM payments
    WHERE 1=1 ${dateFilter}
    GROUP BY status
  `;

  let totalCount = 0;
  let totalAmountPaise = BigInt(0);
  const byStatus = rows.map((r) => {
    const count = Number(r.count);
    const amountPaise = Number(r.amount_paise);
    totalCount += count;
    if (r.status === 'success') {
      totalAmountPaise += BigInt(r.amount_paise);
    }
    return { status: r.status, count, amount_paise: amountPaise };
  });

  return {
    total_count: totalCount,
    total_amount_paise: Number(totalAmountPaise),
    by_status: byStatus,
  };
}

/**
 * Enrollment funnel — count per EnrollmentStatus.
 * Statuses with zero rows are still included in the response with count 0.
 *
 * @param {{ dateFrom?: Date, dateTo?: Date }} opts
 * @returns {Promise<{ stages: Array<{ status: string, count: number }> }>}
 */
async function getEnrollmentsFunnel({ dateFrom, dateTo } = {}) {
  const dateFilter = buildDateFilter(dateFrom, dateTo);

  const rows = await getDb().$queryRaw`
    SELECT
      status::text  AS status,
      COUNT(*)::int AS count
    FROM enrollments
    WHERE deleted_at IS NULL ${dateFilter}
    GROUP BY status
  `;

  const countMap = {};
  for (const r of rows) {
    countMap[r.status] = Number(r.count);
  }

  const stages = ALL_ENROLLMENT_STATUSES.map((s) => ({
    status: s,
    count: countMap[s] || 0,
  }));

  return { stages };
}

/**
 * External API health aggregation.
 * Returns by_status breakdown, the 50 most recent dead_letter rows, and
 * average attempts + duration for successful calls.
 *
 * @param {{ dateFrom?: Date, dateTo?: Date }} opts
 * @returns {Promise<object>}
 */
async function getExternalApiHealth({ dateFrom, dateTo } = {}) {
  const dateFilter = buildDateFilter(dateFrom, dateTo);

  const statusRows = await getDb().$queryRaw`
    SELECT
      status::text  AS status,
      COUNT(*)::int AS count
    FROM external_api_logs
    WHERE 1=1 ${dateFilter}
    GROUP BY status
  `;

  const countMap = {};
  for (const r of statusRows) {
    countMap[r.status] = Number(r.count);
  }

  const byStatus = ALL_EXTERNAL_API_STATUSES.map((s) => ({
    status: s,
    count: countMap[s] || 0,
  }));

  const deadLetterRows = await getDb().$queryRaw`
    SELECT
      id::text,
      enrollment_id::text,
      last_error,
      attempts,
      updated_at
    FROM external_api_logs
    WHERE status = 'dead_letter' ${dateFilter}
    ORDER BY updated_at DESC
    LIMIT 50
  `;

  const avgRows = await getDb().$queryRaw`
    SELECT
      ROUND(AVG(attempts), 2)::float     AS avg_attempts_to_success,
      ROUND(AVG(duration_ms), 2)::float  AS avg_duration_ms_success
    FROM external_api_logs
    WHERE status = 'success' ${dateFilter}
  `;

  const avg = avgRows[0] || {};

  return {
    by_status: byStatus,
    dead_letter_recent: deadLetterRows.map((r) => ({
      id: r.id,
      enrollment_id: r.enrollment_id,
      last_error: r.last_error || null,
      attempts: Number(r.attempts),
      updated_at: r.updated_at,
    })),
    avg_attempts_to_success: avg.avg_attempts_to_success !== null ? Number(avg.avg_attempts_to_success) : null,
    avg_duration_ms_success: avg.avg_duration_ms_success !== null ? Number(avg.avg_duration_ms_success) : null,
  };
}

/**
 * Async generator that yields payment rows in cursor-paginated batches of 500.
 * Each row includes a nested enrollment with the fields needed for the CSV export.
 *
 * Usage:
 *   for await (const row of streamPaymentsForExport({ dateFrom, dateTo })) { ... }
 *
 * @param {{ dateFrom?: Date, dateTo?: Date }} opts
 * @returns {AsyncGenerator<object>}
 */
async function* streamPaymentsForExport({ dateFrom, dateTo } = {}) {
  const BATCH = 500;
  let cursor;

  const where = {};
  if (dateFrom || dateTo) {
    where.created_at = {};
    if (dateFrom) where.created_at.gte = dateFrom;
    if (dateTo) where.created_at.lte = dateTo;
  }

  while (true) {
    const queryOpts = {
      take: BATCH,
      where,
      orderBy: { id: 'asc' },
      select: {
        id: true,
        razorpay_order_id: true,
        razorpay_payment_id: true,
        status: true,
        amount: true,
        currency: true,
        created_at: true,
        enrollment: {
          select: {
            email: true,
            phone_number: true,
            plan: true,
            first_name: true,
            last_name: true,
          },
        },
      },
    };

    if (cursor) {
      queryOpts.cursor = { id: cursor };
      queryOpts.skip = 1;
    }

    const rows = await getDb().payment.findMany(queryOpts);

    if (rows.length === 0) break;

    for (const row of rows) {
      yield row;
    }

    if (rows.length < BATCH) break;

    cursor = rows[rows.length - 1].id;
  }
}

module.exports = {
  getPaymentsSummary,
  getEnrollmentsFunnel,
  getExternalApiHealth,
  streamPaymentsForExport,
};
