-- Migration: sumago_taxonomy_overrides
--
-- Today the enrollment-webhook payload's plan / group / unit / phase /
-- segment values come from FIVE hardcoded env vars (SUMAGO_PLAN_CODE,
-- SUMAGO_GROUP, SUMAGO_UNIT, SUMAGO_PHASE, SUMAGO_SEGMENT). That made
-- every student look identical in Sumago because the values never vary.
--
-- This migration adds optional per-entity OVERRIDES:
--
--   * internal_plans.sumago_plan_code        — overrides SUMAGO_PLAN_CODE
--   * course_master.sumago_group             — overrides SUMAGO_GROUP
--   * course_master.sumago_unit              — overrides SUMAGO_UNIT
--   * course_master.sumago_phase             — overrides SUMAGO_PHASE
--   * course_master.sumago_segment           — overrides SUMAGO_SEGMENT
--
-- All NULLABLE → backward-compatible. The webhook builder will use the
-- override when set, otherwise fall back to the env-var default, so
-- existing enrollments + new ones without an override keep working
-- exactly as they do today.
--
-- Why per-Course for group/unit/phase/segment (not per-InternalPlan):
-- the existing comment in enrollmentWebhook.service.js explains Sumago's
-- group/unit/phase/segment taxonomy is registered org-wide on Sumago
-- side. The natural axis of variation is the COURSE (e.g. "Engineering
-- - UG" vs "Management - PG"), not the plan tier (Silver/Gold/Platinum).
-- Plan tier maps better to the plan_code axis.
--
-- All statements are idempotent so re-running on an already-migrated DB
-- is a no-op.

ALTER TABLE "internal_plans"
  ADD COLUMN IF NOT EXISTS "sumago_plan_code" VARCHAR(100);

ALTER TABLE "course_master"
  ADD COLUMN IF NOT EXISTS "sumago_group"   VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "sumago_unit"    VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "sumago_phase"   VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "sumago_segment" VARCHAR(100);
