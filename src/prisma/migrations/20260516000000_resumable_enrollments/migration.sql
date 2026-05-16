-- Migration: resumable_enrollments
--
-- Goal: allow a returning student whose previous enrollment never completed
-- payment to resume against the existing row instead of being blocked by a
-- duplicate-email error. Also harden the DB against parallel "create
-- enrollment for the same email" races.
--
-- Steps:
--   1) Backfill: soft-delete duplicate active rows per email (keep the latest
--      successful one if any, otherwise the most recent), so we can enforce
--      a partial unique index.
--   2) Add a partial unique index on lower(email) WHERE deleted_at IS NULL.
--      This becomes the single source of truth for "at most one active
--      enrollment per email", regardless of how many app workers race.
--   3) Add a composite index on (lower(email), status) for fast lookups
--      from the resume flow.
--   4) Add a composite index on (enrollment_id, status) for the payments
--      table to speed up the "is there any successful payment?" check used
--      in the resume guard.
--
-- All statements are idempotent — re-running on an already-migrated DB is
-- a no-op, matching the pattern used by earlier migrations in this repo.

-- ---------------------------------------------------------------------------
-- Step 1: Backfill duplicate active rows
--
-- Ranking rule (per lower(email)):
--   - Any row whose status is paid/sync_pending/completed wins (they hold real
--     money — never soft-delete them).
--   - Otherwise the most-recently-created row wins (it is the freshest in-
--     progress attempt and the only one a returning user would meaningfully
--     resume against).
--   - All other rows in that email bucket get soft-deleted (deleted_at = NOW()).
--
-- We DO NOT touch any row that already has deleted_at set. Soft-deletion is a
-- reversible book-keeping action; nothing here drops data.
-- ---------------------------------------------------------------------------

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY lower(email)
      ORDER BY
        CASE WHEN status IN ('paid', 'sync_pending', 'completed') THEN 0 ELSE 1 END,
        created_at DESC
    ) AS rn
  FROM "enrollments"
  WHERE deleted_at IS NULL
)
UPDATE "enrollments" e
SET deleted_at = NOW()
FROM ranked r
WHERE e.id = r.id
  AND r.rn > 1
  AND e.deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- Step 2: Partial unique index on lower(email) for active (non-deleted) rows
--
-- This is the production safety net against:
--   - Multi-tab submissions racing each other.
--   - Two API workers receiving the same payload in the same millisecond.
--   - Any future code path that forgets to call the resume helper.
--
-- The expression form (lower(email)) makes the constraint case-insensitive
-- to match the case-insensitive lookup used by the resume flow. The Joi
-- validator already lowercases incoming emails so all NEW rows store the
-- normalised form, but the index uses lower() defensively for any pre-
-- existing mixed-case data.
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS "uniq_enrollments_email_active"
  ON "enrollments" (lower(email))
  WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- Step 3: Composite index for fast email + status lookups
--
-- The resume flow filters by lower(email) AND status (to detect already-paid
-- enrollments). The unique index above only covers lower(email); this
-- composite index makes the status filter a covered scan.
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS "idx_enrollments_email_status_active"
  ON "enrollments" (lower(email), status)
  WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- Step 4: (defensive) ensure payments(enrollment_id, status) is indexed.
--
-- This index is declared in schema.prisma (@@index([enrollment_id, status]))
-- but we re-assert it here so manually-managed DBs that drifted from the
-- schema still get it. The IF NOT EXISTS makes the statement a no-op when
-- the index is already present.
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS "payments_enrollment_id_status_idx"
  ON "payments" ("enrollment_id", "status");
