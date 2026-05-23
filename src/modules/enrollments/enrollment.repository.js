'use strict';

const { getPrismaClient } = require('../../config/database');
const { ENROLLMENT_DEDUPE_WINDOW_MS } = require('../../config/constants');
const countCache = require('../../utils/countCache');

const ENROLLMENT_COUNT_NAMESPACE = 'admin.enrollments';

function getDb() {
  return getPrismaClient();
}

// Statuses where the enrollment is considered "successfully paid" and must
// be protected from any further mutation by the public website flow. The
// resume guard treats any of these as a hard block — the same email cannot
// start a new enrollment once it has reached one of these states.
//
// Why three: `paid` is set the moment the payment row settles, `sync_pending`
// is the transient phase where we are pushing the enrollment to the external
// system, and `completed` is the terminal state after that sync succeeds.
// All three represent "real money has been collected".
const PAID_ENROLLMENT_STATUSES = ['paid', 'sync_pending', 'completed'];

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
 *
 * Retained for backward compatibility — the resume flow uses the row-locking
 * variant `findActiveByEmailForUpdate` below.
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

/**
 * Look up the single active (non-deleted) enrollment for the given email
 * *inside an interactive transaction* and acquire a row-level lock via
 * SELECT ... FOR UPDATE.
 *
 * The lock guarantees that two concurrent POST /enrollments calls for the
 * same email serialize on the SELECT, so the second one always sees the
 * first one's INSERT (or its UPDATE) and never produces a duplicate row.
 * The partial unique index `uniq_enrollments_email_active` is the DB-level
 * safety net for the case where two transactions get past the SELECT
 * without finding anything and then both try to INSERT — the loser hits
 * P2002 and the caller retries the UPDATE path.
 *
 * The lookup is case-insensitive via lower(email) to match the partial
 * unique index. Joi already lowercases incoming emails so under normal
 * conditions both sides are already lower-case; the lower() wrapper makes
 * the lookup robust to any pre-existing mixed-case rows.
 *
 * Returns the *latest* matching row (post-backfill there is at most one),
 * with the minimum set of columns the resume logic needs.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} email — already lower-cased by validator; lower() wrapped here defensively
 * @returns {Promise<{id: string, status: string, plan_pricing_id: number|null, amount: number|null}|null>}
 */
async function findActiveByEmailForUpdate(tx, email) {
  const rows = await tx.$queryRaw`
    SELECT id, status, plan_pricing_id, amount
    FROM "enrollments"
    WHERE lower(email) = lower(${email}) AND deleted_at IS NULL
    ORDER BY created_at DESC
    LIMIT 1
    FOR UPDATE
  `;
  return rows && rows[0] ? rows[0] : null;
}

/**
 * Returns true iff the given enrollment has at least one Payment row in
 * status='success'. Used as a belt-and-suspenders guard alongside the
 * enrollment.status check — a Payment row in success state is the ultimate
 * source of truth for "this student has paid", so we treat it as an
 * immutable barrier regardless of any status drift on the enrollment row.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient|null} tx
 * @param {string} enrollmentId
 * @returns {Promise<boolean>}
 */
async function hasSuccessfulPayment(tx, enrollmentId) {
  const client = tx || getDb();
  const count = await client.payment.count({
    where: { enrollment_id: enrollmentId, status: 'success' },
  });
  return count > 0;
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

/**
 * Paginated list with a cached COUNT.
 *
 * The findMany and count run in parallel rather than inside a serializable
 * transaction — total is only ever used to drive `totalPages` in the UI,
 * so a microsecond's worth of drift between the count and the page rows
 * is invisible to admins and never wrong-in-a-way-that-matters.
 *
 * COUNT is cached for 60s per unique filter combo (see utils/countCache).
 * On a 10M-row table this turns repeat page-navigation from 200-500ms per
 * request to a single-digit-ms cache hit.
 *
 * Cache is invalidated explicitly by enrollment writes (create / update /
 * soft-delete) elsewhere — see invalidateEnrollmentCounts().
 */
async function listEnrollments({ skip, take, where, orderBy, countTtlMs }) {
  const db = getDb();
  const [rows, total] = await Promise.all([
    db.enrollment.findMany({ skip, take, where, orderBy }),
    countCache.getCount(
      ENROLLMENT_COUNT_NAMESPACE,
      where,
      () => db.enrollment.count({ where }),
      { ttlMs: countTtlMs },
    ),
  ]);
  return { rows, total };
}

/**
 * Drop every cached enrollment count. Call after any write that may change
 * the total (create, soft-delete, status mutation that flips a filterable
 * column). Without this, counts age out by TTL — but a fresh write feels
 * surprising if the count doesn't budge for up to 60s.
 *
 * Cheap: O(n) over the namespace prefix; the cache is bounded at 1024 keys.
 */
function invalidateEnrollmentCounts() {
  countCache.invalidate(ENROLLMENT_COUNT_NAMESPACE);
}

async function updateEnrollmentStatus(id, status) {
  return getDb().enrollment.update({
    where: { id },
    data: { status },
  });
}

/**
 * Update ONLY the external_sync_status column. Kept separate from
 * updateEnrollmentStatus so the third-party sync state never accidentally
 * touches the customer-facing payment lifecycle column.
 *
 * @param {string} id          enrollment UUID
 * @param {'PENDING'|'SUCCESS'|'FAILED'|'DEAD_LETTER'} syncStatus
 */
async function updateExternalSyncStatus(id, syncStatus) {
  return getDb().enrollment.update({
    where: { id },
    data:  { external_sync_status: syncStatus },
  });
}

module.exports = {
  PAID_ENROLLMENT_STATUSES,
  findRecentDuplicate,
  findActiveByEmail,
  findActiveByEmailForUpdate,
  hasSuccessfulPayment,
  createEnrollment,
  findEnrollmentById,
  listEnrollments,
  invalidateEnrollmentCounts,
  updateEnrollmentStatus,
  updateExternalSyncStatus,
};
