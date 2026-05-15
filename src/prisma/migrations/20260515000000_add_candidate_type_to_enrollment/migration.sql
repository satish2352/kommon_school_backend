-- Migration: add_candidate_type_to_enrollment
-- Adds the `candidate_type` column to "Enrollment", backed by the existing
-- "CandidateType" enum, defaulting to 'EXTERNAL'.
--
-- Schema declares the column as nullable with a default of EXTERNAL, but every
-- existing row originated from the public website ("Enroll Now") flow before
-- admin manual/bulk paths were added, so EXTERNAL is the correct backfill.
--
-- All statements are idempotent so re-running on an already-migrated DB is a
-- no-op, matching the pattern used by 20260509000000_add_plans_and_plan_pricing.

-- ---------------------------------------------------------------------------
-- Step 1: Enum (no-op if already present)
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE "CandidateType" AS ENUM ('INTERNAL', 'EXTERNAL');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ---------------------------------------------------------------------------
-- Step 2: Column on Enrollment (no-op if already present)
-- ---------------------------------------------------------------------------

ALTER TABLE "enrollments"
  ADD COLUMN IF NOT EXISTS "candidate_type" "CandidateType" DEFAULT 'EXTERNAL';

-- ---------------------------------------------------------------------------
-- Step 3: Backfill any pre-existing rows (no-op when the column was just added
-- with the DEFAULT, but harmless to re-run).
-- ---------------------------------------------------------------------------

UPDATE "enrollments"
SET "candidate_type" = 'EXTERNAL'
WHERE "candidate_type" IS NULL;
