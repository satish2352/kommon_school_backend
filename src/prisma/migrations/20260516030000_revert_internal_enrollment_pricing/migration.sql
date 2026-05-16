-- Migration: revert_internal_enrollment_pricing
--
-- Reverts the schema changes added by:
--   - 20260516010000_internal_enrollment_pricing
--   - 20260516020000_add_internal_payment_status
--
-- Drops in safe order:
--   1. Indexes that reference the new columns
--   2. Foreign-key constraint to internal_plans
--   3. Columns themselves
--   4. The InternalPaymentStatus enum (once nothing references it)
--
-- All statements use IF EXISTS so re-running on an already-reverted DB
-- is a no-op. DATA LOSS WARNING: this drops 8 columns from `enrollments`
-- — any values stored in them (test enrollments with coupon data) are
-- permanently destroyed. The user explicitly approved this destructive
-- revert.

-- ---------------------------------------------------------------------------
-- Step 1: Drop indexes added by the two forward migrations.
-- ---------------------------------------------------------------------------

DROP INDEX IF EXISTS "uniq_enrollments_internal_plan_id";
DROP INDEX IF EXISTS "idx_enrollments_internal_plan_id";
DROP INDEX IF EXISTS "idx_enrollments_coupon_code_snapshot";
DROP INDEX IF EXISTS "idx_enrollments_internal_payment_status_created";
DROP INDEX IF EXISTS "enrollments_internal_plan_id_idx";
DROP INDEX IF EXISTS "enrollments_internal_payment_status_created_at_idx";

-- ---------------------------------------------------------------------------
-- Step 2: Drop the foreign-key constraint to internal_plans BEFORE the
-- column, otherwise PostgreSQL refuses the column drop.
-- ---------------------------------------------------------------------------

ALTER TABLE "enrollments"
  DROP CONSTRAINT IF EXISTS "enrollments_internal_plan_id_fkey";

-- ---------------------------------------------------------------------------
-- Step 3: Drop the columns added by the two forward migrations.
-- Order doesn't matter for column drops; grouped alphabetically.
-- ---------------------------------------------------------------------------

ALTER TABLE "enrollments"
  DROP COLUMN IF EXISTS "amount_paid_paise",
  DROP COLUMN IF EXISTS "base_price_paise",
  DROP COLUMN IF EXISTS "coupon_code_snapshot",
  DROP COLUMN IF EXISTS "coupon_snapshot",
  DROP COLUMN IF EXISTS "discount_amount_paise",
  DROP COLUMN IF EXISTS "final_amount_paise",
  DROP COLUMN IF EXISTS "internal_payment_status",
  DROP COLUMN IF EXISTS "internal_plan_id";

-- ---------------------------------------------------------------------------
-- Step 4: Drop the InternalPaymentStatus enum once no column references it.
-- ---------------------------------------------------------------------------

DROP TYPE IF EXISTS "InternalPaymentStatus";
