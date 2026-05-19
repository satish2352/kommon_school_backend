-- Migration: readd_internal_enrollment_pricing
--
-- Re-introduces the admin-internal enrollment financial snapshot that
-- was previously added in 20260516010000_* / 20260516020000_* and then
-- dropped in 20260516030000_revert_internal_enrollment_pricing.
--
-- Identical SQL effect to the original two migrations combined, but in
-- a single new forward step because Prisma migrations are append-only
-- and the prior two are already marked applied + reverted.
--
-- Note on coupon usage-limit policy: this migration adds NO column for
-- usedCount — usage tracking lives inside InternalPlan.coupons JSON
-- (existing). The service layer increments `coupons[i].usedCount` under
-- a SELECT ... FOR UPDATE on the internal_plans row when a coupon is
-- redeemed by an admin enrollment, so two concurrent admin submissions
-- cannot both squeak past the limit.
--
-- All statements are idempotent so re-running on an already-migrated DB
-- is a no-op, matching the project convention.

-- ---------------------------------------------------------------------------
-- Step 1: InternalPaymentStatus enum
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE "InternalPaymentStatus" AS ENUM ('PENDING', 'PARTIAL', 'PAID', 'FULLY_DISCOUNTED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ---------------------------------------------------------------------------
-- Step 2: Eight nullable columns on `enrollments`.
-- amount_paid_paise defaults to 0 so non-internal rows stay consistent
-- with INT NOT NULL semantics if any code happens to coalesce on it.
-- ---------------------------------------------------------------------------

ALTER TABLE "enrollments"
  ADD COLUMN IF NOT EXISTS "internal_plan_id"        INTEGER,
  ADD COLUMN IF NOT EXISTS "base_price_paise"        INTEGER,
  ADD COLUMN IF NOT EXISTS "discount_amount_paise"   INTEGER,
  ADD COLUMN IF NOT EXISTS "final_amount_paise"      INTEGER,
  ADD COLUMN IF NOT EXISTS "amount_paid_paise"       INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "coupon_code_snapshot"    VARCHAR(50),
  ADD COLUMN IF NOT EXISTS "coupon_snapshot"         JSONB,
  ADD COLUMN IF NOT EXISTS "internal_payment_status" "InternalPaymentStatus";

-- ---------------------------------------------------------------------------
-- Step 3: FK to internal_plans (ON DELETE SET NULL so deleting a plan
-- doesn't cascade-delete enrollments — they keep the snapshot columns
-- as the historical truth even if the live plan vanishes).
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
-- Step 4: Indexes for admin list filtering + reports.
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS "idx_enrollments_internal_plan_id"
  ON "enrollments" ("internal_plan_id");

CREATE INDEX IF NOT EXISTS "idx_enrollments_coupon_code_snapshot"
  ON "enrollments" (lower("coupon_code_snapshot"))
  WHERE "coupon_code_snapshot" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_enrollments_internal_payment_status_created"
  ON "enrollments" ("internal_payment_status", "created_at" DESC)
  WHERE "internal_payment_status" IS NOT NULL;
