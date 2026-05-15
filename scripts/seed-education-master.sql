-- ============================================================
-- seed-education-master.sql
--
-- Seed the 7 standard education-level rows so the Courses form
-- can attach a valid Education FK. Mirrors the values the
-- backend's `npm run db:seed` originally inserted.
--
-- Idempotent via ON CONFLICT (name) DO NOTHING — `name` is @unique.
-- ============================================================

INSERT INTO education_master
  (name,          code,            description,                      status,   is_system_default, created_at, updated_at)
VALUES
  ('School',         'SCHOOL',         'School-level (up to 10th)',          'ACTIVE', false, NOW(), NOW()),
  ('Jr College',     'JR_COLLEGE',     '11th and 12th / Junior College',     'ACTIVE', false, NOW(), NOW()),
  ('Undergraduate',  'UNDERGRADUATE',  'Bachelor''s degree (in progress)',   'ACTIVE', false, NOW(), NOW()),
  ('Graduate',       'GRADUATE',       'Bachelor''s degree (completed)',     'ACTIVE', false, NOW(), NOW()),
  ('Post Graduate',  'POST_GRADUATE',  'Master''s degree',                   'ACTIVE', false, NOW(), NOW()),
  ('Doctorate',      'DOCTORATE',      'PhD / Doctorate',                     'ACTIVE', false, NOW(), NOW()),
  ('Other',          'OTHER',          'Other / Unspecified',                 'ACTIVE', false, NOW(), NOW())
ON CONFLICT (name) DO NOTHING;
