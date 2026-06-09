-- Decommission the Sumago override fields:
--   course_master: coupon, sumago_group, sumago_unit, sumago_phase, sumago_segment
--   internal_plans: sumago_plan_code
--
-- The provision-user webhook now derives `group` from the course name and uses
-- fixed defaults for unit/phase/segment; `plan` uses the per-plan externalPlanId
-- (planId) falling back to SUMAGO_PLAN_CODE. No per-row override remains.
--
-- IDEMPOTENT (IF EXISTS) so it is safe to (re)apply.

ALTER TABLE "course_master"
  DROP COLUMN IF EXISTS "coupon",
  DROP COLUMN IF EXISTS "sumago_group",
  DROP COLUMN IF EXISTS "sumago_unit",
  DROP COLUMN IF EXISTS "sumago_phase",
  DROP COLUMN IF EXISTS "sumago_segment";

ALTER TABLE "internal_plans"
  DROP COLUMN IF EXISTS "sumago_plan_code";
