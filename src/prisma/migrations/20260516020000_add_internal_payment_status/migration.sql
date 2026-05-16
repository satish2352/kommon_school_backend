-- Migration: add_internal_payment_status
--
-- Adds the InternalPaymentStatus enum + the matching nullable column on
-- the `enrollments` table, and backfills it for every existing internal
-- enrollment based on the financial-snapshot columns that already live
-- on the row.
--
-- Why store it instead of computing on read:
--   - The list page filters by payment status; an indexed column is
--     much cheaper than a CASE-expression filter.
--   - Reports and CSV exports need a stable, single source of truth.
--   - Future partial-payment writes can keep the status in sync as part
--     of the same transaction that mutates `amount_paid_paise`.
--
-- The column stays NULLABLE so non-internal enrollments (public website
-- flow, legacy data) don't carry a misleading value. Anything joining
-- on `internal_plan_id IS NOT NULL` will always see a non-null status.
--
-- All statements are idempotent: re-running on an already-migrated DB
-- is a no-op.

-- ---------------------------------------------------------------------------
-- Step 1: Enum
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE "InternalPaymentStatus" AS ENUM ('PENDING', 'PARTIAL', 'PAID', 'FULLY_DISCOUNTED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ---------------------------------------------------------------------------
-- Step 2: Column on enrollments (nullable; only populated for internal)
-- ---------------------------------------------------------------------------

ALTER TABLE "enrollments"
  ADD COLUMN IF NOT EXISTS "internal_payment_status" "InternalPaymentStatus";

-- ---------------------------------------------------------------------------
-- Step 3: Backfill from financial-snapshot columns.
--
-- Rules (matching the runtime calculator in adminEnrollment.service.js):
--   final = 0 AND base > 0          → FULLY_DISCOUNTED
--   paid >= final AND final > 0     → PAID
--   paid > 0 AND paid < final       → PARTIAL
--   ELSE                             → PENDING
--
-- WHERE filter scopes the update strictly to internal-flow rows: an
-- enrollment without internal_plan_id (i.e. public-website flow) is
-- intentionally left as NULL.
-- ---------------------------------------------------------------------------

UPDATE "enrollments"
SET "internal_payment_status" = CASE
  WHEN COALESCE("final_amount_paise", 0) = 0
       AND COALESCE("base_price_paise", 0) > 0
    THEN 'FULLY_DISCOUNTED'::"InternalPaymentStatus"
  WHEN COALESCE("amount_paid_paise", 0) >= COALESCE("final_amount_paise", 0)
       AND COALESCE("final_amount_paise", 0) > 0
    THEN 'PAID'::"InternalPaymentStatus"
  WHEN COALESCE("amount_paid_paise", 0) > 0
       AND COALESCE("amount_paid_paise", 0) < COALESCE("final_amount_paise", 0)
    THEN 'PARTIAL'::"InternalPaymentStatus"
  ELSE 'PENDING'::"InternalPaymentStatus"
END
WHERE "internal_plan_id" IS NOT NULL
  AND "internal_payment_status" IS NULL;

-- ---------------------------------------------------------------------------
-- Step 4: Composite index for "filter by status + sort by date" admin list.
-- The list page's default sort is created_at DESC, so the index leads
-- with status (filter selectivity) then created_at (ordering).
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS "idx_enrollments_internal_payment_status_created"
  ON "enrollments" ("internal_payment_status", "created_at" DESC)
  WHERE "internal_payment_status" IS NOT NULL;
