-- ============================================================
-- update-course-fees.sql
--
-- Set all course_master.course_fee values to 2-digit numbers.
-- Progression preserves duration ordering so the data still tells
-- a coherent "longer = pricier" story.
--
--   30 Days  → 30
--   45 Days  → 45
--   3 Months → 60
--   6 Months → 75
--   9 Months → 99
-- ============================================================

UPDATE course_master AS cm
SET
  course_fee = (CASE
    WHEN dm.sort_order = 30  THEN 30
    WHEN dm.sort_order = 45  THEN 45
    WHEN dm.sort_order = 90  THEN 60
    WHEN dm.sort_order = 180 THEN 75
    WHEN dm.sort_order = 270 THEN 99
    ELSE cm.course_fee
  END)::numeric(10,2),
  updated_at = NOW()
FROM duration_master AS dm
WHERE cm.duration_id = dm.id;
