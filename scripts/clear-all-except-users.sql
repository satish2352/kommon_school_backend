-- ============================================================
-- clear-all-except-users.sql
--
-- Wipe every table EXCEPT users + auth dependencies.
--
-- PRESERVE:
--   users                     (login records)
--   permissions               (auth lookup — required for role checks)
--   role_permissions          (role -> permission mapping)
--   razorpay_configurations   (encrypted production payment keys)
--
-- TRUNCATE: everything else (transactional + catalog/master).
--
-- Run via:
--   cd backend
--   npx prisma db execute --file scripts/clear-all-except-users.sql --schema src/prisma/schema.prisma
-- ============================================================

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
