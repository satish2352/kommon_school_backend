-- ============================================================
-- seed-courses-durations-and-plan.sql
--
-- 1. Insert 5 durations into `duration_master`
-- 2. Insert 35 course rows into `course_master` (7 courses × 5 durations)
-- 3. Insert 1 dummy `InternalPlan` linked to a real course + duration
--
-- Assumes the target tables were truncated beforehand
-- (e.g. via clear-all-except-users.sql) — otherwise inserts will append.
-- `duration_master.label` is UNIQUE, so the `ON CONFLICT` clause keeps it
-- idempotent if you re-run after a partial failure.
--
-- Run via:
--   cd backend
--   npx prisma db execute --file scripts/seed-courses-durations-and-plan.sql --schema src/prisma/schema.prisma
-- ============================================================

-- 1. Durations (5 rows). Sort order = nominal days; preserves chronological order.
INSERT INTO duration_master
  (label, sort_order, status, is_system_default, created_at, updated_at)
VALUES
  ('30 Days',  30,  'ACTIVE', false, NOW(), NOW()),
  ('45 Days',  45,  'ACTIVE', false, NOW(), NOW()),
  ('3 Months', 90,  'ACTIVE', false, NOW(), NOW()),
  ('6 Months', 180, 'ACTIVE', false, NOW(), NOW()),
  ('9 Months', 270, 'ACTIVE', false, NOW(), NOW())
ON CONFLICT (label) DO NOTHING;

-- 2. 35 course rows = CROSS JOIN of 7 course names × the 5 durations seeded above.
INSERT INTO course_master
  (name_of_course_as_group, course_fee, status, is_system_default, duration_id, created_at, updated_at)
SELECT
  c.course_name,
  0.00,
  'ACTIVE'::"CourseStatus",
  false,
  d.id,
  NOW(),
  NOW()
FROM (
  VALUES
    ('Full Stack Development Using Python'),
    ('UI / UX Designing'),
    ('Data Analytics Using Python'),
    ('Web Designing and Development Using React'),
    ('Mobile Application Development'),
    ('Full Stack Java Development'),
    ('Data Science and AI / ML')
) AS c(course_name)
CROSS JOIN duration_master d
WHERE d.label IN ('30 Days', '45 Days', '3 Months', '6 Months', '9 Months');

-- 3. One dummy InternalPlan — picks the row for course "Data Science and AI / ML"
--    paired with duration "6 Months", then creates an InternalPlan referencing it.
--    refId uses gen_random_uuid() to mirror the Node side `iplan_<uuid>` pattern.
INSERT INTO internal_plans
  (ref_id, name, duration, description, course_id, status, coupons, created_at, updated_at)
SELECT
  'iplan_' || gen_random_uuid(),
  'Dummy — Data Science 6 Month Intensive',
  '6_MONTHS'::"InternalPlanDuration",
  'Sample internal plan auto-generated for testing the Internal Plans flow.',
  cm.id,
  'ACTIVE'::"InternalPlanStatus",
  '[]'::jsonb,
  NOW(),
  NOW()
FROM course_master cm
JOIN duration_master dm ON dm.id = cm.duration_id
WHERE cm.name_of_course_as_group = 'Data Science and AI / ML'
  AND dm.label = '6 Months'
LIMIT 1;
