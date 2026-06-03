-- Migration: add_external_plan_id_to_plan_pricing
--
-- Adds an `external_plan_id` column to `plan_pricing`. This is a per-(plan, duration)
-- identifier used as the `planId` field in the Sumago provision-user webhook payload.
-- It is independent of the SUMAGO_PLAN_CODE env default (which feeds the legacy
-- `plan` field on the enrollment row and stays untouched).
--
-- Decisions (per product owner):
--   * Required on every NEW write (Joi validation enforces this; column stays
--     NULL-allowed at the DB level so this migration runs cleanly against
--     existing rows that have no value yet).
--   * Admin must backfill existing rows manually via the admin UI before
--     enrollment payments are made — the webhook payload will include
--     `planId: null` until then, but storage and lookup still work.
--   * UNIQUE across the table — no two pricing rows may share the same
--     external_plan_id. Implemented as a partial UNIQUE index so NULL
--     entries (existing unbackfilled rows) don't conflict with each other.

-- ---------------------------------------------------------------------------
-- 1. Add the column (idempotent — survives re-runs against an already-patched DB)
-- ---------------------------------------------------------------------------
ALTER TABLE "plan_pricing"
  ADD COLUMN IF NOT EXISTS "external_plan_id" VARCHAR(100);

-- ---------------------------------------------------------------------------
-- 2. UNIQUE constraint via partial index — ignores NULLs so the migration
--    works against existing rows that have not been backfilled yet.
--    Once admin fills in values via the UI, the index enforces uniqueness.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS "plan_pricing_external_plan_id_key"
  ON "plan_pricing" ("external_plan_id")
  WHERE "external_plan_id" IS NOT NULL;
