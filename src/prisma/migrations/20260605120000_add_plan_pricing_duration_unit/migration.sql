-- Add a duration unit (DAYS | MONTHS) to plan_pricing so admins can define
-- day-based pricing as well as month-based. Existing rows are month-based, so
-- default + backfill to 'MONTHS'. The numeric value stays in duration_months.
ALTER TABLE "plan_pricing"
  ADD COLUMN "duration_unit" VARCHAR(10) NOT NULL DEFAULT 'MONTHS';
