INSERT INTO duration_master
  (label,      sort_order, status,   is_system_default, created_at, updated_at)
VALUES
  ('30 Days',  30,         'ACTIVE', false, NOW(), NOW()),
  ('45 Days',  45,         'ACTIVE', false, NOW(), NOW()),
  ('3 Months', 90,         'ACTIVE', false, NOW(), NOW()),
  ('6 Months', 180,        'ACTIVE', false, NOW(), NOW()),
  ('9 Months', 270,        'ACTIVE', false, NOW(), NOW())
ON CONFLICT (label) DO NOTHING;
