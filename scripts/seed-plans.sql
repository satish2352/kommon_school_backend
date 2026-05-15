-- ============================================================
-- seed-plans.sql — 3 plans (SILVER / GOLD / PLATINUM) × 4 durations
--
-- After this runs you have:
--   3 rows in `plans`           (one per tier — `tier` is @unique)
--   12 rows in `plan_pricing`   (3 plans × 4 durations)
--
-- Assumes plans + plan_pricing tables are empty. If not, the
-- unique constraint on tier will block re-runs.
-- ============================================================

-- 1. Plans
INSERT INTO plans
  (name, tier, tagline, description, features, highlight_label, promo_code, sort_order, status, is_system_default, created_at, updated_at)
VALUES
  ('Silver',   'SILVER',   'Get started with the essentials',
   'Core curriculum + recorded lessons. Great for learners on a budget.',
   '["Access to recorded lessons","Community forum","Monthly newsletter","Certificate of completion"]'::jsonb,
   NULL,        'NEW501',  10, 'ACTIVE', false, NOW(), NOW()),
  ('Gold',     'GOLD',     'Live mentorship + projects',
   'Everything in Silver plus live mentor sessions, capstone projects, and 1:1 doubt clearing.',
   '["Everything in Silver","Live mentor sessions","Capstone projects","1:1 doubt clearing","Resume review"]'::jsonb,
   'Most Popular','NEW501',  20, 'ACTIVE', false, NOW(), NOW()),
  ('Platinum', 'PLATINUM', 'Placement guarantee + 1:1 coaching',
   'Everything in Gold plus dedicated career coach, mock interviews, and a placement guarantee.',
   '["Everything in Gold","Dedicated career coach","Unlimited mock interviews","Placement guarantee","Lifetime alumni access"]'::jsonb,
   NULL,        'NEW501',  30, 'ACTIVE', false, NOW(), NOW());

-- 2. Plan pricing (12 rows = 3 plans × 4 durations). Progressive discount on longer durations.
--    Final price = base_price × duration_months × (1 - discount_percent/100)
INSERT INTO plan_pricing
  (plan_id, duration_months, base_price, discount_percent, final_price, discount_label, status, created_at, updated_at)
SELECT
  p.id,
  dur,
  base_pm,
  disc,
  ROUND(base_pm * dur * (100 - disc) / 100, 2),
  CASE WHEN disc > 0 THEN disc::text || '% off' ELSE NULL END,
  'ACTIVE'::"PlanStatus",
  NOW(),
  NOW()
FROM plans p
JOIN (
  VALUES
    ('SILVER',    1,   999.00,  0.00),
    ('SILVER',    3,   999.00,  5.00),
    ('SILVER',    6,   999.00, 10.00),
    ('SILVER',   12,   999.00, 15.00),
    ('GOLD',      1,  1999.00,  0.00),
    ('GOLD',      3,  1999.00, 10.00),
    ('GOLD',      6,  1999.00, 15.00),
    ('GOLD',     12,  1999.00, 25.00),
    ('PLATINUM',  1,  2999.00,  0.00),
    ('PLATINUM',  3,  2999.00, 15.00),
    ('PLATINUM',  6,  2999.00, 20.00),
    ('PLATINUM', 12,  2999.00, 30.00)
) AS t(tier, dur, base_pm, disc) ON p.tier::text = t.tier;
