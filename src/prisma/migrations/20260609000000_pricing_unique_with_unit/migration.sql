-- Allow the same numeric duration to coexist in different units on one plan
-- (e.g. "2 Days" and "2 Months"). Uniqueness moves from
-- (plan_id, duration_months) to (plan_id, duration_months, duration_unit).
--
-- Safe/relaxing change: every existing (plan_id, duration_months) pair is still
-- unique under the wider key, so no current row can violate the new index.

DROP INDEX IF EXISTS "plan_pricing_plan_id_duration_months_key";

CREATE UNIQUE INDEX "plan_pricing_plan_id_duration_months_duration_unit_key"
  ON "plan_pricing"("plan_id", "duration_months", "duration_unit");
