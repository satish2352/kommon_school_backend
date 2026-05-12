-- ============================================================
-- reset-and-seed-courses.sql
--
-- Wipe non-user tables (catalog + transactional), then insert
-- 5 durations and 35 course rows (7 courses × 5 durations each).
--
-- PRESERVE: users, permissions, role_permissions,
--           razorpay_configurations
--
-- Run via:
--   cd backend
--   npx prisma db execute \
--     --file scripts/reset-and-seed-courses.sql \
--     --schema src/prisma/schema.prisma
-- ============================================================

-- 1. Wipe non-user data. RESTART IDENTITY resets serial PKs so
--    new rows start at 1. CASCADE handles FK chains atomically.
TRUNCATE TABLE
  followup_notes,
  audit_logs,
  followups,
  external_api_logs,
  webhook_delivery,
  webhook_events,
  payments,
  enrollments,
  refresh_tokens,
  plan_pricing,
  plans,
  course_master,
  duration_master,
  education_master
RESTART IDENTITY CASCADE;

-- 2. Insert 5 durations into duration_master.
INSERT INTO duration_master
  (label,      sort_order, status,   is_system_default, created_at, updated_at)
VALUES
  ('30 Days',  30,         'ACTIVE', false, NOW(), NOW()),
  ('45 Days',  45,         'ACTIVE', false, NOW(), NOW()),
  ('3 Months', 90,         'ACTIVE', false, NOW(), NOW()),
  ('6 Months', 180,        'ACTIVE', false, NOW(), NOW()),
  ('9 Months', 270,        'ACTIVE', false, NOW(), NOW());

-- 3. Insert 35 course rows by CROSS JOIN of 7 courses × 5 durations.
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
