-- Rollback migration: add_payments_enrollments_followups
-- Run this to revert all tables and enums added by this migration.
-- CAUTION: This is destructive — all data in these tables will be lost.

-- Drop tables in reverse dependency order
DROP TABLE IF EXISTS "external_api_logs" CASCADE;
DROP TABLE IF EXISTS "webhook_events" CASCADE;
DROP TABLE IF EXISTS "ledger_entries" CASCADE;
DROP TABLE IF EXISTS "payment_audit_logs" CASCADE;
DROP TABLE IF EXISTS "payments" CASCADE;
DROP TABLE IF EXISTS "idempotency_keys" CASCADE;
DROP TABLE IF EXISTS "razorpay_configs" CASCADE;
DROP TABLE IF EXISTS "follow_ups" CASCADE;
DROP TABLE IF EXISTS "enrollments" CASCADE;

-- Remove new columns added to existing tables (if any)
-- (None in this migration — enrollments, payments, follow_ups are all new tables)

-- Drop enums (only if no other table uses them)
DROP TYPE IF EXISTS "SyncStatus";
DROP TYPE IF EXISTS "InteractionOutcome";
DROP TYPE IF EXISTS "InteractionType";
DROP TYPE IF EXISTS "UserResponse";
DROP TYPE IF EXISTS "FollowUpPriority";
DROP TYPE IF EXISTS "FollowUpStatus";
DROP TYPE IF EXISTS "LedgerSource";
DROP TYPE IF EXISTS "LedgerEntryType";
DROP TYPE IF EXISTS "PaymentFailureType";
DROP TYPE IF EXISTS "PaymentStatus";
DROP TYPE IF EXISTS "EnrollmentStatus";
DROP TYPE IF EXISTS "LeadSource";
DROP TYPE IF EXISTS "PlacementReadiness";
DROP TYPE IF EXISTS "EducationLevel";
DROP TYPE IF EXISTS "EnrollmentRole";

-- Remove new roles added to UserRole enum
-- PostgreSQL does not support DROP VALUE on enums.
-- To remove ADMIN and MARKETING from UserRole, recreate the enum:
-- ALTER TYPE "UserRole" RENAME TO "UserRole_old";
-- CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER', 'STUDENT', 'PARENT');
-- ALTER TABLE "users" ALTER COLUMN "role" TYPE "UserRole" USING "role"::text::"UserRole";
-- DROP TYPE "UserRole_old";
