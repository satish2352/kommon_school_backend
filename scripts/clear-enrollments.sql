-- ---------------------------------------------------------------------------
-- clear-enrollments.sql
--
-- Wipes ALL enrollment data while KEEPING plans + their related master data
-- and all system/config tables. Re-runnable (idempotent — TRUNCATE on empty
-- tables is a no-op).
--
-- DELETES:
--   enrollments              — the enrollments themselves
--   payments                 — Razorpay/admin payment rows (FK → enrollments)
--   external_api_logs        — Sumago sync attempt logs (FK → enrollments)
--   followups, followup_notes— follow-up pipeline (FK → enrollments/followups)
--   webhook_delivery         — outbound webhook delivery history
--   webhook_events           — inbound webhook event log
--   email_logs               — sent-email log
--   sumago_users             — mirrored students from the Sumago get-users sync
--   audit_logs               — admin action history
--
-- KEEPS (untouched):
--   plans, plan_pricing, internal_plans,
--   course_master, course_name_master, duration_master, education_master,
--   users, permissions, role_permissions, refresh_tokens,
--   razorpay_configurations, _prisma_migrations
--
-- RESTART IDENTITY resets any serial sequences on the cleared tables.
-- CASCADE is safe here: the only tables that reference the cleared ones are
-- themselves in the list (payments/external_api_logs/followups → enrollments,
-- followup_notes → followups). No kept table references a cleared table.
--
-- ⚠️  IRREVERSIBLE. Take a backup first if unsure:
--       pg_dump "$DATABASE_URL" > backup_before_clear.sql
--
-- Run with:
--       psql "$DATABASE_URL" -f scripts/clear-enrollments.sql
-- ---------------------------------------------------------------------------

BEGIN;

TRUNCATE TABLE
  followup_notes,
  followups,
  payments,
  external_api_logs,
  webhook_delivery,
  webhook_events,
  email_logs,
  enrollments,
  sumago_users,
  audit_logs
RESTART IDENTITY CASCADE;

COMMIT;

-- Post-run sanity check — every count below should be 0.
SELECT 'enrollments'       AS table, COUNT(*) AS rows FROM enrollments
UNION ALL SELECT 'payments',           COUNT(*) FROM payments
UNION ALL SELECT 'external_api_logs',  COUNT(*) FROM external_api_logs
UNION ALL SELECT 'followups',          COUNT(*) FROM followups
UNION ALL SELECT 'followup_notes',     COUNT(*) FROM followup_notes
UNION ALL SELECT 'webhook_delivery',   COUNT(*) FROM webhook_delivery
UNION ALL SELECT 'webhook_events',     COUNT(*) FROM webhook_events
UNION ALL SELECT 'email_logs',         COUNT(*) FROM email_logs
UNION ALL SELECT 'sumago_users',       COUNT(*) FROM sumago_users
UNION ALL SELECT 'audit_logs',         COUNT(*) FROM audit_logs
UNION ALL SELECT 'plans (kept)',       COUNT(*) FROM plans
UNION ALL SELECT 'plan_pricing (kept)',COUNT(*) FROM plan_pricing;
