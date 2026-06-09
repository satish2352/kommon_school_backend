-- ============================================================
-- clear-menubar-data.sql
--
-- Wipes every table backing the admin menubar, and removes all
-- non-admin login accounts. Keeps ONLY the auth/config plumbing
-- needed for admin + superadmin to log in and process payments.
--
-- Menubar -> table mapping cleared here:
--   Enrollments / Internal Enrollments / New Enrollment / Bulk Upload
--                              -> enrollments
--   Payments                  -> payments
--   Follow-ups                -> followups, followup_notes
--   Sumago: Provision (POST)  -> external_api_logs, webhook_delivery
--   Sumago: Fetch Users (GET) -> sumago_users, webhook_events
--   Email Logs                -> email_logs
--   Plans / External Plan     -> plans, plan_pricing
--   Internal Plans            -> internal_plans
--   Course Names              -> course_name_master
--   Courses                   -> course_master
--   Duration Master           -> duration_master
--   (off-menu, cleared per request) -> education_master, audit_logs
--
-- PRESERVED:
--   users                   -> ONLY role IN ('superadmin','admin')
--   refresh_tokens          -> ONLY for preserved users
--   razorpay_configurations -> encrypted live payment keys
--   permissions, role_permissions -> auth role mapping
--
-- ⚠️  IRREVERSIBLE. Target is the shared remote DB (13.48.254.211).
--
-- Run with:
--   cd backend
--   npx prisma db execute --file scripts/clear-menubar-data.sql --schema src/prisma/schema.prisma
-- ============================================================

BEGIN;

-- 1) Wipe all transactional + catalog/master + log tables.
--    CASCADE resolves the enrollment/plan/course FK chains; every
--    referencing table is itself in this list.
TRUNCATE TABLE
  followup_notes,
  followups,
  audit_logs,
  payments,
  external_api_logs,
  webhook_delivery,
  webhook_events,
  email_logs,
  sumago_users,
  enrollments,
  internal_plans,
  plan_pricing,
  plans,
  course_master,
  course_name_master,
  duration_master,
  education_master
RESTART IDENTITY CASCADE;

-- 2) Drop refresh tokens belonging to the soon-to-be-deleted users
--    (refresh_tokens.user_id -> users is ON DELETE RESTRICT).
DELETE FROM refresh_tokens
WHERE user_id IN (
  SELECT id FROM users WHERE role NOT IN ('superadmin', 'admin')
);

-- 3) Delete every non-admin login (marketing + student).
DELETE FROM users
WHERE role NOT IN ('superadmin', 'admin');

COMMIT;
