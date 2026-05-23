-- Migration: enrollment_list_pagination_indexes
--
-- Production-grade indexes for the admin Enrollments list query
-- (GET /api/v1/admin/enrollments). Every filter the admin UI exposes
-- gets a covering index so list queries stay sub-100ms on a table with
-- millions of rows.
--
-- All indexes are PARTIAL on `deleted_at IS NULL` because the list query
-- never touches soft-deleted rows — a partial cover is dramatically
-- smaller than a full one once tombstone count grows.
--
-- Why each index exists:
--   * created_at DESC           — default sort; powers the unfiltered list page
--   * candidate_type            — Candidate Type dropdown (Internal/External)
--   * status                    — admin status filter
--   * external_sync_status      — Sync filter + retry workflow
--   * trgm GIN on email/name    — case-insensitive ILIKE search box
--   * phone_number              — admins paste phone numbers into search
--
-- NOTE for production rollout on already-large tables: this file uses
-- plain `CREATE INDEX IF NOT EXISTS`. On tables with millions of rows,
-- prefer running the same statements as `CREATE INDEX CONCURRENTLY` in
-- a separate maintenance window so writes are not blocked. Prisma cannot
-- ship CONCURRENTLY inside its transactional migrations, so the DBA must
-- apply that variant manually if writes-during-build are a concern.

-- ---------------------------------------------------------------------------
-- 0. pg_trgm extension — required for GIN trigram indexes used by the
--    case-insensitive substring search on email / name columns. Idempotent.
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------------
-- 1. Default-sort cover: ORDER BY created_at DESC on non-deleted rows.
--    Powers the unfiltered "/admin/enrollments" landing page.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "enrollments_active_created_at_desc_idx"
  ON "enrollments" ("created_at" DESC)
  WHERE "deleted_at" IS NULL;

-- ---------------------------------------------------------------------------
-- 2. Candidate-type filter + default sort.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "enrollments_candidate_type_created_at_idx"
  ON "enrollments" ("candidate_type", "created_at" DESC)
  WHERE "deleted_at" IS NULL;

-- ---------------------------------------------------------------------------
-- 3. Status filter + default sort. Replaces the bare `(status)` index for
--    the common "status + ORDER BY created_at" access pattern. The bare
--    index is kept (it's used by other modules) but the planner will
--    prefer this composite when both predicate and sort are present.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "enrollments_status_created_at_idx"
  ON "enrollments" ("status", "created_at" DESC)
  WHERE "deleted_at" IS NULL;

-- ---------------------------------------------------------------------------
-- 4. External sync state filter + default sort. Powers "show me all FAILED
--    syncs sorted by recency" in the admin retry workflow.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "enrollments_ext_sync_created_at_idx"
  ON "enrollments" ("external_sync_status", "created_at" DESC)
  WHERE "deleted_at" IS NULL AND "external_sync_status" IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 5. Trigram GIN on text columns used by the OR-of-ILIKE search clause in
--    enrollment.service.listEnrollments. One index per column so the
--    planner can BitmapOr them together as the WHERE clause demands.
--
--    `lower(col) gin_trgm_ops` lets ILIKE '%term%' use the index because
--    Prisma's `contains: term, mode: 'insensitive'` lowers both sides at
--    query time. Without `lower(...)` the index is unused.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "enrollments_email_trgm_idx"
  ON "enrollments" USING gin (lower("email") gin_trgm_ops)
  WHERE "deleted_at" IS NULL;

CREATE INDEX IF NOT EXISTS "enrollments_name_trgm_idx"
  ON "enrollments" USING gin (lower("name") gin_trgm_ops)
  WHERE "deleted_at" IS NULL AND "name" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "enrollments_first_name_trgm_idx"
  ON "enrollments" USING gin (lower("first_name") gin_trgm_ops)
  WHERE "deleted_at" IS NULL AND "first_name" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "enrollments_last_name_trgm_idx"
  ON "enrollments" USING gin (lower("last_name") gin_trgm_ops)
  WHERE "deleted_at" IS NULL AND "last_name" IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 6. Phone-number btree (prefix search). Admins frequently paste a phone
--    number into the search box — a partial btree gives O(log n) prefix
--    matches without bloating the trgm indexes with numeric strings.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "enrollments_phone_number_idx"
  ON "enrollments" ("phone_number")
  WHERE "deleted_at" IS NULL AND "phone_number" IS NOT NULL;
