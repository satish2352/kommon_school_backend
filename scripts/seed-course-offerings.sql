-- ============================================================
-- seed-course-offerings.sql
--
-- Create the full 7 × 5 = 35 course offerings by CROSS JOIN of:
--   - the 7 real course names in course_name_master
--   - the 5 durations in duration_master
--
-- Each row:
--   - course_name_id    → FK to course_name_master
--   - duration_id       → FK to duration_master
--   - name_of_course_as_group → denormalised name (read by downstream services)
--   - course_fee        → scaled by duration so the data is plausible
--   - status            → ACTIVE
--   - is_system_default → false
--
-- UNIQUE constraint @@unique([courseNameId, durationId]) means re-runs of
-- this script will conflict. Run it once on an empty course_master table.
-- ============================================================

INSERT INTO course_master
  (course_name_id, duration_id, name_of_course_as_group, course_fee, status, is_system_default, created_at, updated_at)
SELECT
  cn.id,
  d.id,
  cn.name,
  -- Dummy fee scaled by nominal duration (sort_order = nominal days)
  CASE
    WHEN d.sort_order <= 30  THEN  9999.00
    WHEN d.sort_order <= 45  THEN 14999.00
    WHEN d.sort_order <= 90  THEN 24999.00
    WHEN d.sort_order <= 180 THEN 44999.00
    ELSE                          64999.00
  END,
  'ACTIVE'::"CourseStatus",
  false,
  NOW(),
  NOW()
FROM course_name_master cn
CROSS JOIN duration_master d
WHERE cn.status = 'ACTIVE'
  AND d.status  = 'ACTIVE'
  AND cn.name IN (
    'Full Stack Development Using Python',
    'UI / UX Designing',
    'Data Analytics Using Python',
    'Web Designing and Development Using React',
    'Mobile Application Development',
    'Full Stack Java Development',
    'Data Science and AI / ML'
  );
