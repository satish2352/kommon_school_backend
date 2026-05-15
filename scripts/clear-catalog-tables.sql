-- ============================================================
-- clear-catalog-tables.sql
--
-- Truncate all rows from the four catalog tables:
--   - internal_plans
--   - course_master
--   - course_name_master
--   - duration_master
--
-- CASCADE handles the FK chain (internal_plans.course_id → course_master,
-- course_master.course_name_id → course_name_master,
-- course_master.duration_id → duration_master).
-- RESTART IDENTITY resets all auto-increment sequences so the next
-- inserted row gets id=1.
-- ============================================================

TRUNCATE TABLE
  internal_plans,
  course_master,
  course_name_master,
  duration_master
RESTART IDENTITY CASCADE;
