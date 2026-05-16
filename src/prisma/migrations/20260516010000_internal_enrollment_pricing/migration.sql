-- Migration: internal_enrollment_pricing
--
-- Adds first-class storage on the `enrollments` table for the
-- admin-internal flow's pricing breakdown:
--
--   - which InternalPlan the enrollment is bound to
--   - the original course fee (base) frozen at enrollment time
--   - the discount amount applied (computed server-side from the coupon)
--   - the final payable (base - discount), authoritative for accounting
--   - the running paid total (set equal to final today; partial-payment
--     ready when we add a /record-payment UI later)
--   - a snapshot of the coupon row (full JSON) so a future edit or
--     deletion of the coupon doesn't rewrite history
--   - the literal coupon code for quick filtering/reporting
--
-- All new columns are NULLABLE except `amount_paid_paise` (defaults to 0).
-- Existing rows (public website + prior admin enrollments) keep working
-- untouched because nothing they depend on changed.
--
-- All statements are idempotent so re-running on an already-migrated DB
-- is a no-op, matching the project convention.

-- ---------------------------------------------------------------------------
-- Step 1: New columns on `enrollments`
-- ---------------------------------------------------------------------------

ALTER TABLE "enrollments"
  ADD COLUMN IF NOT EXISTS "internal_plan_id"        INTEGER,
  ADD COLUMN IF NOT EXISTS "base_price_paise"        INTEGER,
  ADD COLUMN IF NOT EXISTS "discount_amount_paise"   INTEGER,
  ADD COLUMN IF NOT EXISTS "final_amount_paise"      INTEGER,
  ADD COLUMN IF NOT EXISTS "amount_paid_paise"       INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "coupon_code_snapshot"    VARCHAR(50),
  ADD COLUMN IF NOT EXISTS "coupon_snapshot"         JSONB;

-- ---------------------------------------------------------------------------
-- Step 2: Foreign key to internal_plans.
-- ON DELETE SET NULL — never lose an enrollment record because an admin
-- archived the plan. The snapshot columns retain enough info to
-- reconstruct what was sold even after the plan row vanishes.
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  ALTER TABLE "enrollments"
    ADD CONSTRAINT "enrollments_internal_plan_id_fkey"
    FOREIGN KEY ("internal_plan_id") REFERENCES "internal_plans"("id")
    ON DELETE SET NULL
    ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ---------------------------------------------------------------------------
-- Step 3: Index for "list all enrollments for plan X" admin reports.
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS "idx_enrollments_internal_plan_id"
  ON "enrollments" ("internal_plan_id");

-- ---------------------------------------------------------------------------
-- Step 4: Index on coupon_code_snapshot for "all redemptions of code X"
-- admin reports. Coupons are stored on the plan, not as standalone rows,
-- so this lookup has no other index path today.
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS "idx_enrollments_coupon_code_snapshot"
  ON "enrollments" (lower("coupon_code_snapshot"))
  WHERE "coupon_code_snapshot" IS NOT NULL;
