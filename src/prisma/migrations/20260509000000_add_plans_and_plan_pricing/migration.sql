-- Migration: add_plans_and_plan_pricing
-- Handles both:
--   (a) fresh empty DB  — creates PlanTier, PlanStatus enums + plans + plan_pricing tables
--   (b) existing dev DB — renames camelCase columns to snake_case, adds missing columns
-- All statements are idempotent via IF NOT EXISTS / DO $$ ... $$ guards.

-- ---------------------------------------------------------------------------
-- Step 1: Enums (CREATE TYPE has no IF NOT EXISTS in Postgres; use DO block)
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE "PlanTier" AS ENUM ('SILVER', 'GOLD', 'PLATINUM');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "PlanStatus" AS ENUM ('ACTIVE', 'INACTIVE');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ---------------------------------------------------------------------------
-- Step 2: Create plans table if it does not exist (fresh DB path)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "plans" (
    "id"               SERIAL          NOT NULL,
    "name"             VARCHAR(100)    NOT NULL,
    "tier"             "PlanTier"      NOT NULL,
    "tagline"          VARCHAR(200),
    "description"      TEXT,
    "features"         JSONB           NOT NULL DEFAULT '[]',
    "highlight_label"  VARCHAR(50),
    "promo_code"       VARCHAR(50),
    "sort_order"       INTEGER         NOT NULL DEFAULT 0,
    "status"           "PlanStatus"    NOT NULL DEFAULT 'ACTIVE',
    "is_system_default" BOOLEAN        NOT NULL DEFAULT false,
    "created_at"       TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"       TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------------------
-- Step 3: Create plan_pricing table if it does not exist (fresh DB path)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "plan_pricing" (
    "id"               SERIAL          NOT NULL,
    "plan_id"          INTEGER         NOT NULL,
    "duration_months"  INTEGER         NOT NULL,
    "base_price"       DECIMAL(10,2)   NOT NULL,
    "discount_percent" DECIMAL(5,2)    NOT NULL DEFAULT 0,
    "final_price"      DECIMAL(10,2)   NOT NULL,
    "discount_label"   VARCHAR(100),
    "status"           "PlanStatus"    NOT NULL DEFAULT 'ACTIVE',
    "created_at"       TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"       TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "plan_pricing_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------------------
-- Step 4: Indexes and unique constraints (IF NOT EXISTS)
-- ---------------------------------------------------------------------------

-- plans unique tier
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE tablename = 'plans' AND indexname = 'plans_tier_key'
  ) THEN
    CREATE UNIQUE INDEX "plans_tier_key" ON "plans"("tier");
  END IF;
END $$;

-- Drop old camelCase index on plans if present (from an earlier migration attempt)
DROP INDEX IF EXISTS "plans_status_sortOrder_idx";

-- plans status + sort_order composite index
CREATE INDEX IF NOT EXISTS "plans_status_sort_order_idx" ON "plans"("status", "sort_order");

-- plan_pricing status index
CREATE INDEX IF NOT EXISTS "plan_pricing_status_idx" ON "plan_pricing"("status");

-- plan_pricing unique compound key (plan_id, duration_months)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE tablename = 'plan_pricing' AND indexname = 'plan_pricing_plan_id_duration_months_key'
  ) THEN
    CREATE UNIQUE INDEX "plan_pricing_plan_id_duration_months_key" ON "plan_pricing"("plan_id", "duration_months");
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Step 5: Foreign key from plan_pricing -> plans (idempotent)
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'plan_pricing_plan_id_fkey'
      AND table_name = 'plan_pricing'
  ) THEN
    ALTER TABLE "plan_pricing"
      ADD CONSTRAINT "plan_pricing_plan_id_fkey"
      FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Step 6: Patch plans table for existing dev DB (camelCase → snake_case renames)
--         All ops are guarded so they are no-ops on a fresh DB (column already
--         created with the correct name in Step 2).
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  -- highlight_label: rename from camelCase if it exists under the wrong name
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'plans' AND column_name = 'highlightLabel'
  ) THEN
    ALTER TABLE "plans" RENAME COLUMN "highlightLabel" TO "highlight_label";
  END IF;

  -- promo_code: add if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'plans' AND column_name = 'promo_code'
  ) THEN
    ALTER TABLE "plans" ADD COLUMN "promo_code" VARCHAR(50);
  END IF;

  -- sort_order: rename from camelCase or add
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'plans' AND column_name = 'sort_order'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'plans' AND column_name = 'sortOrder'
    ) THEN
      ALTER TABLE "plans" RENAME COLUMN "sortOrder" TO "sort_order";
    ELSE
      ALTER TABLE "plans" ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 0;
    END IF;
  END IF;

  -- is_system_default: rename from camelCase or add
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'plans' AND column_name = 'is_system_default'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'plans' AND column_name = 'isSystemDefault'
    ) THEN
      ALTER TABLE "plans" RENAME COLUMN "isSystemDefault" TO "is_system_default";
    ELSE
      ALTER TABLE "plans" ADD COLUMN "is_system_default" BOOLEAN NOT NULL DEFAULT false;
    END IF;
  END IF;

  -- created_at: rename from camelCase or add
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'plans' AND column_name = 'created_at'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'plans' AND column_name = 'createdAt'
    ) THEN
      ALTER TABLE "plans" RENAME COLUMN "createdAt" TO "created_at";
    ELSE
      ALTER TABLE "plans" ADD COLUMN "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
    END IF;
  END IF;

  -- updated_at: rename from camelCase or add
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'plans' AND column_name = 'updated_at'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'plans' AND column_name = 'updatedAt'
    ) THEN
      ALTER TABLE "plans" RENAME COLUMN "updatedAt" TO "updated_at";
    ELSE
      ALTER TABLE "plans" ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
    END IF;
  END IF;
END
$$;

-- Drop leftover camelCase columns from plans if they somehow still exist
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'plans' AND column_name = 'sortOrder'
  ) THEN
    ALTER TABLE "plans" DROP COLUMN "sortOrder";
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'plans' AND column_name = 'isSystemDefault'
  ) THEN
    ALTER TABLE "plans" DROP COLUMN "isSystemDefault";
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'plans' AND column_name = 'createdAt'
  ) THEN
    ALTER TABLE "plans" DROP COLUMN "createdAt";
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'plans' AND column_name = 'updatedAt'
  ) THEN
    ALTER TABLE "plans" DROP COLUMN "updatedAt";
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Step 7: Patch plan_pricing table for existing dev DB
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  -- created_at
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'plan_pricing' AND column_name = 'created_at'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'plan_pricing' AND column_name = 'createdAt'
    ) THEN
      ALTER TABLE "plan_pricing" RENAME COLUMN "createdAt" TO "created_at";
    ELSE
      ALTER TABLE "plan_pricing" ADD COLUMN "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
    END IF;
  END IF;

  -- updated_at
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'plan_pricing' AND column_name = 'updated_at'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'plan_pricing' AND column_name = 'updatedAt'
    ) THEN
      ALTER TABLE "plan_pricing" RENAME COLUMN "updatedAt" TO "updated_at";
    ELSE
      ALTER TABLE "plan_pricing" ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
    END IF;
  END IF;
END
$$;

-- Drop leftover camelCase columns from plan_pricing
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'plan_pricing' AND column_name = 'createdAt'
  ) THEN
    ALTER TABLE "plan_pricing" DROP COLUMN "createdAt";
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'plan_pricing' AND column_name = 'updatedAt'
  ) THEN
    ALTER TABLE "plan_pricing" DROP COLUMN "updatedAt";
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Step 8: Add plan_pricing_id FK column to enrollments (idempotent)
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'enrollments' AND column_name = 'plan_pricing_id'
  ) THEN
    ALTER TABLE "enrollments" ADD COLUMN "plan_pricing_id" INTEGER;
    ALTER TABLE "enrollments"
      ADD CONSTRAINT "enrollments_plan_pricing_id_fkey"
      FOREIGN KEY ("plan_pricing_id") REFERENCES "plan_pricing"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;
