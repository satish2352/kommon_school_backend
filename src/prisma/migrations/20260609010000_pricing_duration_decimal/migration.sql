-- Allow fractional plan-pricing durations (e.g. "1.5 Months") by widening the
-- duration value from INTEGER to NUMERIC(10,2). Existing whole-number values
-- convert losslessly (1 -> 1.00). Postgres automatically rebuilds the
-- (plan_id, duration_months, duration_unit) unique index for the new type.

ALTER TABLE "plan_pricing"
  ALTER COLUMN "duration_months" TYPE NUMERIC(10,2) USING "duration_months"::numeric;
