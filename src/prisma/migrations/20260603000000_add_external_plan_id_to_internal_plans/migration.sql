-- Migration: add_external_plan_id_to_internal_plans
--
-- Adds an `external_plan_id` column to `internal_plans`. This is the per-internal-plan
-- identifier sent as the `planId` field in the Sumago provision-user webhook payload
-- (e.g. SUMAGOTEST_SCOPE_30DAYS). Independent of the existing optional `sumago_plan_code`
-- override (which feeds the legacy `plan` field) — they coexist.
--
-- Decisions (per product owner):
--   * Required on every NEW write (Joi validation enforces this; column stays
--     NULL-allowed at the DB level so this migration runs cleanly against
--     existing rows that have no value yet).
--   * Admin backfills existing rows manually via the admin UI before
--     enrollment payments are made.
--   * UNIQUE across the table — no two internal plans may share the same
--     external_plan_id. Implemented as a partial UNIQUE index so NULL
--     entries (existing unbackfilled rows) don't conflict with each other.

-- ---------------------------------------------------------------------------
-- 1. Add the column (idempotent — survives re-runs against an already-patched DB)
-- ---------------------------------------------------------------------------
ALTER TABLE "internal_plans"
  ADD COLUMN IF NOT EXISTS "external_plan_id" VARCHAR(100);

-- ---------------------------------------------------------------------------
-- 2. UNIQUE constraint via partial index — ignores NULLs so the migration
--    works against existing rows that have not been backfilled yet.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS "internal_plans_external_plan_id_key"
  ON "internal_plans" ("external_plan_id")
  WHERE "external_plan_id" IS NOT NULL;
