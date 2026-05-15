-- ============================================================
-- seed-course-names.sql
--
-- Insert 7 unique course names into course_name_master.
-- Idempotent — ON CONFLICT (name) DO NOTHING means re-runs are safe.
-- ============================================================

INSERT INTO course_name_master
  (name,                                              description, status,   is_system_default, created_at, updated_at)
VALUES
  ('Full Stack Development Using Python',             NULL, 'ACTIVE', false, NOW(), NOW()),
  ('UI / UX Designing',                               NULL, 'ACTIVE', false, NOW(), NOW()),
  ('Data Analytics Using Python',                     NULL, 'ACTIVE', false, NOW(), NOW()),
  ('Web Designing and Development Using React',       NULL, 'ACTIVE', false, NOW(), NOW()),
  ('Mobile Application Development',                  NULL, 'ACTIVE', false, NOW(), NOW()),
  ('Full Stack Java Development',                     NULL, 'ACTIVE', false, NOW(), NOW()),
  ('Data Science and AI / ML',                        NULL, 'ACTIVE', false, NOW(), NOW())
ON CONFLICT (name) DO NOTHING;
