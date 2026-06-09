'use strict';

/**
 * sumagoUserSync.service.js
 *
 * Owns the read/write side of the local `sumago_users` mirror table.
 *
 *   syncFromSumago(traceId)
 *     - Calls Sumago GET /integrations/get-users.
 *     - Buckets the response into NEW / CHANGED / UNCHANGED by email.
 *     - Bulk-inserts the new rows and per-row UPDATEs the changed ones.
 *     - Skips writes entirely for users whose content_hash is identical
 *       to what we already have — saves write IO on the common case.
 *
 *   listFromDb(traceId)
 *     - Reads all rows from sumago_users (no per-org filter for now —
 *       env token currently points at a single org; we still capture
 *       organization_code per row for the day we go multi-tenant).
 *     - Enriches each row with our local enrollment join (same shape
 *       the old controller built so the frontend can stay unchanged):
 *       localPayment, localCandidateType, localEnrollmentCode,
 *       localCreatedAt, localPlan.
 *
 * Why a SHA-256 contentHash instead of a per-column diff:
 *   Sumago's response can grow new fields (they're an active product)
 *   and we want UPDATE-detection to be future-proof. Hashing the
 *   canonical JSON catches changes anywhere in the payload, including
 *   new keys we don't model as columns yet, with one cheap comparison.
 */

const crypto = require('crypto');
const { getPrismaClient } = require('../../config/database');
const logger        = require('../../config/logger');
const sumagoService = require('./sumago.service');

function getDb() {
  return getPrismaClient();
}

// -----------------------------------------------------------------------------
// Internal helpers
// -----------------------------------------------------------------------------

function lowerEmail(value) {
  return String(value || '').trim().toLowerCase();
}

// Recursively sort object keys so a deterministic JSON.stringify can be
// hashed regardless of upstream key ordering. Arrays are NOT reordered —
// planHistory[] order is semantically meaningful (chronological).
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const sortedKeys = Object.keys(value).sort();
    const out = {};
    for (const k of sortedKeys) out[k] = canonicalize(value[k]);
    return out;
  }
  return value;
}

function computeContentHash(payload) {
  const canonical = JSON.stringify(canonicalize(payload));
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

function tokenHash() {
  const tok = process.env.EXTERNAL_API_TOKEN || '';
  if (!tok) return null;
  return crypto.createHash('sha256').update(tok).digest('hex');
}

// Map one Sumago user object to a row shape (sans bookkeeping). Used
// both for insert and update payloads.
function mapToRow(sumagoUser, organizationCode) {
  return {
    email:            lowerEmail(sumagoUser.email),
    firstName:        sumagoUser.firstName       ?? null,
    lastName:         sumagoUser.lastName        ?? null,
    phoneNumber:      sumagoUser.phoneNumber     ?? null,
    plan:             sumagoUser.plan            ?? null,
    groupName:        sumagoUser.group           ?? null,
    unit:             sumagoUser.unit            ?? null,
    phase:            sumagoUser.phase           ?? null,
    segment:          sumagoUser.segment         ?? null,
    emailStatus:      sumagoUser.emailStatus     ?? null,
    onboardingStatus: sumagoUser.onboardingStatus?? null,
    planHistory:      Array.isArray(sumagoUser.planHistory) ? sumagoUser.planHistory : [],
    organizationCode: organizationCode || null,
    tenantTokenHash:  tokenHash(),
    rawPayload:       sumagoUser,
    contentHash:      computeContentHash(sumagoUser),
  };
}

// Same internal-shape duration formatters the old controller used.
const INTERNAL_DURATION_LABEL = {
  '1_MONTH':   '1 Month',
  '3_MONTHS':  '3 Months',
  '6_MONTHS':  '6 Months',
  '12_MONTHS': '12 Months',
};
function fmtInternalDuration(enumVal) {
  return INTERNAL_DURATION_LABEL[enumVal] || (enumVal || null);
}
function fmtPublicDuration(n, unit = 'MONTHS') {
  const num = Number(n);
  if (!Number.isFinite(num) || num <= 0) return null;
  if (String(unit).toUpperCase() === 'DAYS') {
    return num === 1 ? '1 Day' : `${num} Days`;
  }
  return num === 1 ? '1 Month' : `${num} Months`;
}
function buildLocalPlan(e) {
  if (e?.internal_plan) {
    return {
      name:       e.internal_plan.name || null,
      duration:   fmtInternalDuration(e.internal_plan.duration),
      courseName: e.internal_plan.course?.nameOfCourseAsGroup || null,
      source:     'INTERNAL',
    };
  }
  if (e?.plan_pricing) {
    return {
      name:       e.plan_pricing.plan?.name || null,
      duration:   fmtPublicDuration(e.plan_pricing.durationMonths, e.plan_pricing.durationUnit),
      courseName: null,
      source:     'EXTERNAL',
    };
  }
  return null;
}

// -----------------------------------------------------------------------------
// Bulk upsert
// -----------------------------------------------------------------------------

/**
 * Fetch from Sumago and reconcile against our local mirror.
 *
 * Algorithm:
 *   1. GET Sumago users.
 *   2. Map each to a row shape with a SHA-256 content hash.
 *   3. SELECT existing rows by email (single query, IN(...)).
 *   4. Bucket:
 *        - inserts   → email not in our DB
 *        - updates   → email in our DB AND content_hash differs
 *        - unchanged → email in our DB AND content_hash matches
 *   5. createMany({ data: inserts, skipDuplicates: true })
 *      Per-row update for changed (parallelized but bounded).
 *
 * Returns: { fetched, inserted, updated, unchanged, organizationCode }
 */
async function syncFromSumago(traceId) {
  const db = getDb();
  const startMs = Date.now();

  const sumagoBody = await sumagoService.fetchUsers(traceId);
  const sumagoUsers = Array.isArray(sumagoBody?.users) ? sumagoBody.users : [];
  // Sumago returns both spellings depending on deployment.
  const organizationCode =
    sumagoBody?.organisationCode ?? sumagoBody?.organizationCode ?? null;

  // Build row shapes + filter out entries without a usable email
  // (the unique index requires lower(email)).
  const rows = [];
  for (const u of sumagoUsers) {
    const email = lowerEmail(u?.email);
    if (!email) continue;
    rows.push(mapToRow(u, organizationCode));
  }
  // Defensive: if Sumago returns the same email twice in one response
  // (shouldn't happen), keep the LAST occurrence so createMany doesn't
  // hit a unique violation.
  const byEmail = new Map();
  for (const r of rows) byEmail.set(r.email, r);
  const dedupedRows = Array.from(byEmail.values());
  const emails = dedupedRows.map((r) => r.email);

  if (dedupedRows.length === 0) {
    logger.info({
      msg: 'sumago_sync_empty',
      traceId,
      duration_ms: Date.now() - startMs,
    });
    return {
      fetched: 0, inserted: 0, updated: 0, unchanged: 0,
      organizationCode,
    };
  }

  // Single batched SELECT for existing rows. Returns only the columns
  // we need for the diff decision (email + content_hash + pk).
  const existing = await db.sumagoUser.findMany({
    where:  { email: { in: emails } },
    select: { id: true, email: true, contentHash: true },
  });
  const existingByEmail = new Map();
  for (const e of existing) existingByEmail.set(e.email, e);

  const inserts = [];
  const updates = [];
  let unchanged = 0;

  for (const row of dedupedRows) {
    const found = existingByEmail.get(row.email);
    if (!found) {
      inserts.push(row);
    } else if (found.contentHash !== row.contentHash) {
      updates.push({ id: found.id, data: row });
    } else {
      unchanged += 1;
    }
  }

  // Bulk insert. skipDuplicates protects against a concurrent sync
  // racing in another worker — the second one just no-ops the race.
  let inserted = 0;
  if (inserts.length > 0) {
    const result = await db.sumagoUser.createMany({
      data:           inserts,
      skipDuplicates: true,
    });
    inserted = result.count;
  }

  // Updates. We bump last_synced_at + updated_at on every changed row.
  // Run them in a transaction so a partial failure doesn't leave the
  // mirror half-updated.
  if (updates.length > 0) {
    await db.$transaction(
      updates.map(({ id, data }) =>
        db.sumagoUser.update({
          where: { id },
          data:  {
            ...data,
            lastSyncedAt: new Date(),
            updatedAt:    new Date(),
          },
        }),
      ),
    );
  }

  // Touch last_synced_at on unchanged rows so "stale row" queries work.
  // Single SQL UPDATE rather than per-row to keep this cheap even at
  // scale (millions of users).
  if (unchanged > 0) {
    const unchangedEmails = dedupedRows
      .filter((r) => {
        const found = existingByEmail.get(r.email);
        return found && found.contentHash === r.contentHash;
      })
      .map((r) => r.email);
    if (unchangedEmails.length > 0) {
      await db.sumagoUser.updateMany({
        where: { email: { in: unchangedEmails } },
        data:  { lastSyncedAt: new Date() },
      });
    }
  }

  logger.info({
    msg:         'sumago_sync_done',
    traceId,
    fetched:     dedupedRows.length,
    inserted,
    updated:     updates.length,
    unchanged,
    organizationCode,
    duration_ms: Date.now() - startMs,
  });

  return {
    fetched:  dedupedRows.length,
    inserted,
    updated:  updates.length,
    unchanged,
    organizationCode,
  };
}

// -----------------------------------------------------------------------------
// Read + enrich (server-side paginated)
// -----------------------------------------------------------------------------

// Whitelist for ORDER BY — string concat into Prisma is safe via objects, but
// we still validate against a fixed set to prevent malformed clients from
// asking for non-existent columns.
const SORT_COLUMN_WHITELIST = new Set([
  'lastSyncedAt',
  'firstSeenAt',
  'email',
  'id',
]);
// Map "snake_case from URL" → "camelCase Prisma field". Keeps the URL contract
// stable (admins / scripts use snake_case) while letting Prisma keep its
// JS-style names.
const SORT_COLUMN_ALIAS = {
  last_synced_at: 'lastSyncedAt',
  first_seen_at:  'firstSeenAt',
  email:          'email',
  id:             'id',
};

// Max page size we'll honour. Frontend's dropdown caps lower; this is a hard
// stop for direct API users. 200 keeps the enrollment-join query bounded
// (worst case: IN-list of 200 emails, well within Postgres limits).
const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 25;

function normaliseListOpts(opts = {}) {
  const page  = Math.max(1, parseInt(opts.page, 10) || 1);
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, parseInt(opts.limit, 10) || DEFAULT_LIMIT),
  );
  const skip = (page - 1) * limit;

  const aliased = SORT_COLUMN_ALIAS[opts.sortBy] || opts.sortBy;
  const sortBy  = SORT_COLUMN_WHITELIST.has(aliased) ? aliased : 'lastSyncedAt';
  const sortOrder = opts.sortOrder === 'asc' ? 'asc' : 'desc';

  const search = typeof opts.search === 'string' ? opts.search.trim() : '';
  const onboardingStatus = typeof opts.onboardingStatus === 'string'
    ? opts.onboardingStatus.trim()
    : '';

  // candidate_type lives on enrollments, not sumago_users. Implemented as a
  // join filter — see comment in listFromDb.
  const validCandidateTypes = new Set(['INTERNAL', 'EXTERNAL', 'UNKNOWN']);
  const candidateType = validCandidateTypes.has(opts.candidateType)
    ? opts.candidateType
    : null;

  return { page, limit, skip, sortBy, sortOrder, search, onboardingStatus, candidateType };
}

/**
 * Paginated read from the local sumago_users mirror, enriched with our
 * enrollments join.
 *
 * Performance characteristics (at millions of rows):
 *   - findMany + count run in a single $transaction so they see the same
 *     snapshot — no "off-by-one between rows and total" UI jitter.
 *   - ORDER BY uses indexed columns (last_synced_at, first_seen_at, email
 *     via the lower(email) unique index, or PK id).
 *   - Search predicates use case-insensitive `contains` (ILIKE under the
 *     hood). Email/phone are the high-cardinality lookups admins do —
 *     when search is provided we OR across the four name/contact columns.
 *     At 10M+ rows we'd add a trigram index on (lower(email)) — out of
 *     scope for this change but trivial to add later via migration.
 *   - The enrollment-join enrichment scans only the PAGE (≤ limit rows),
 *     so it's O(limit), independent of total table size.
 *
 * @param {object} opts
 * @param {number} [opts.page]        1-indexed page number
 * @param {number} [opts.limit]       page size (1–200)
 * @param {string} [opts.search]      ILIKE across email/firstName/lastName/phone
 * @param {string} [opts.onboardingStatus]
 * @param {string} [opts.candidateType]   INTERNAL | EXTERNAL | UNKNOWN (filters via enrollment join)
 * @param {string} [opts.sortBy]      last_synced_at | first_seen_at | email | id
 * @param {string} [opts.sortOrder]   asc | desc
 * @param {string} traceId
 */
async function listFromDb(opts, traceId) {
  const db = getDb();
  const norm = normaliseListOpts(opts || {});
  const { page, limit, skip, sortBy, sortOrder, search, onboardingStatus, candidateType } = norm;

  // ---- WHERE clause builder ----
  // AND-combined filters; case-insensitive search OR-combined across four
  // identity columns so admins don't have to know which one to search by.
  const where = {};
  if (search) {
    where.OR = [
      { email:       { contains: search, mode: 'insensitive' } },
      { firstName:   { contains: search, mode: 'insensitive' } },
      { lastName:    { contains: search, mode: 'insensitive' } },
      { phoneNumber: { contains: search, mode: 'insensitive' } },
    ];
  }
  if (onboardingStatus) {
    where.onboardingStatus = onboardingStatus;
  }

  // candidate_type lives on `enrollments`, not `sumago_users`, so we
  // resolve it via a two-step: first read the matching email set from
  // enrollments, then constrain the main query with `email IN (…)` or
  // `email NOT IN (…)`. The intermediate set is bounded by LOCAL
  // enrollments (your DB, typically thousands), independent of Sumago's
  // total user count, so this stays fast even as sumago_users grows
  // into the millions. At very large scale (~50k+ enrollments) we'd
  // switch to a CTE + IN-subquery for a single round-trip.
  if (candidateType) {
    const enrollmentWhere = candidateType === 'UNKNOWN'
      ? { deleted_at: null }                                      // all known
      : { deleted_at: null, candidate_type: candidateType };      // specific type
    const enrolEmails = await db.enrollment.findMany({
      where:  enrollmentWhere,
      select: { email: true },
    });
    const emailSet = Array.from(
      new Set(enrolEmails.map((e) => String(e.email || '').toLowerCase()).filter(Boolean)),
    );

    if (candidateType === 'UNKNOWN') {
      // sumago_users not present in our enrollments table.
      where.email = { notIn: emailSet };
    } else if (emailSet.size === 0 || emailSet.length === 0) {
      // INTERNAL/EXTERNAL filter with no matching enrollments — empty page.
      return {
        status:           'success',
        organizationCode: null,
        totalUsers:       0,
        users:            [],
        meta:             { page, limit, total: 0, totalPages: 0 },
      };
    } else {
      where.email = { in: emailSet };
    }
  }

  // ---- Indexed ORDER BY ----
  // Secondary sort by id ensures a deterministic order when the primary
  // column has ties (e.g. millions of rows synced in the same second).
  // Without this, OFFSET pagination can show duplicate / missing rows.
  const orderBy = [{ [sortBy]: sortOrder }];
  if (sortBy !== 'id') orderBy.push({ id: 'desc' });

  // ---- Page + total in one transaction ----
  // $transaction in Prisma runs both queries against the same snapshot,
  // so the total count cannot drift relative to the rows on the page.
  const [rows, total] = await db.$transaction([
    db.sumagoUser.findMany({ where, orderBy, skip, take: limit }),
    db.sumagoUser.count({ where }),
  ]);

  const totalPages = Math.ceil(total / limit) || 0;

  if (rows.length === 0) {
    // Pick a sensible organizationCode for the empty-state header. If the
    // table has any row at all (just filtered out), we can still surface
    // an org name from the first row of an unfiltered count probe — but
    // returning null here is fine; the UI handles "—" gracefully.
    return {
      status:           'success',
      organizationCode: null,
      totalUsers:       total,
      users:            [],
      meta:             { page, limit, total, totalPages },
    };
  }

  const organizationCode = rows[0]?.organizationCode ?? null;

  // ---- Enrichment: bounded join (only the PAGE's emails) ----
  const emails = rows.map((r) => r.email);
  const localEnrollments = await db.enrollment.findMany({
    where:  { email: { in: emails }, deleted_at: null },
    select: {
      email:                   true,
      enrollment_code:         true,
      id:                      true,
      created_at:              true,
      final_amount_paise:      true,
      amount_paid_paise:       true,
      amount:                  true,
      status:                  true,
      coupon_code_snapshot:    true,
      internal_payment_status: true,
      candidate_type:          true,
      internal_plan: {
        select: {
          name:     true,
          duration: true,
          course:   { select: { nameOfCourseAsGroup: true } },
        },
      },
      plan_pricing: {
        select: {
          durationMonths: true,
          durationUnit:   true,
          plan: { select: { name: true } },
        },
      },
    },
  });

  const byEmail = new Map();
  for (const e of localEnrollments) {
    const key = String(e.email || '').toLowerCase();
    if (!byEmail.has(key)) byEmail.set(key, e);
  }

  const users = rows.map((r) => {
    const sumagoUser = {
      userId:           r.rawPayload?.userId ?? null,
      firstName:        r.firstName,
      lastName:         r.lastName,
      email:            r.email,
      phoneNumber:      r.phoneNumber,
      plan:             r.plan,
      group:            r.groupName,
      unit:             r.unit,
      phase:            r.phase,
      segment:          r.segment,
      emailStatus:      r.emailStatus,
      onboardingStatus: r.onboardingStatus,
      planHistory:      Array.isArray(r.planHistory) ? r.planHistory : [],
      _localSync: {
        firstSeenAt:  r.firstSeenAt,
        lastSyncedAt: r.lastSyncedAt,
      },
    };

    const e = byEmail.get(r.email) || null;
    if (!e) {
      return {
        ...sumagoUser,
        localPayment:        null,
        localCandidateType:  null,
        localEnrollmentCode: null,
        localCreatedAt:      null,
        localPlan:           null,
      };
    }

    const finalPaise = e.final_amount_paise ?? e.amount ?? null;
    const paidPaise  = e.amount_paid_paise ?? (finalPaise ?? 0);

    return {
      ...sumagoUser,
      localEnrollmentCode: e.enrollment_code || e.id || null,
      localCreatedAt:      e.created_at instanceof Date
        ? e.created_at.toISOString()
        : (e.created_at ?? null),
      localCandidateType:  e.candidate_type || 'EXTERNAL',
      localPlan:           buildLocalPlan(e),
      localPayment: {
        finalAmountPaise: finalPaise,
        amountPaidPaise:  paidPaise,
        pendingPaise: (finalPaise != null)
          ? Math.max(0, finalPaise - paidPaise)
          : null,
        couponCode:            e.coupon_code_snapshot ?? null,
        internalPaymentStatus: e.internal_payment_status ?? null,
        enrollmentStatus:      e.status ?? null,
        candidateType:         e.candidate_type || 'EXTERNAL',
      },
    };
  });

  logger.info({
    msg:     'sumago_users_list',
    traceId,
    page, limit, total, totalPages,
    rows_returned: users.length,
    sortBy, sortOrder,
    has_search: Boolean(search),
    onboardingStatus: onboardingStatus || null,
    candidateType:    candidateType || null,
  });

  return {
    status:           'success',
    organizationCode,
    totalUsers:       total,
    users,
    meta:             { page, limit, total, totalPages },
  };
}

module.exports = { syncFromSumago, listFromDb };
