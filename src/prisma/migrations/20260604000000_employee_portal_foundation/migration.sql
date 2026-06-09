-- Migration: employee_portal_foundation
--
-- Foundation schema changes for the new Employee Follow-Up Portal.
-- Bundles three tightly-coupled changes that must land together so the
-- application code (Prisma client, validators, services) stays in sync:
--
--   1. Role enum: add 'employee' value
--   2. FollowupStatus enum: add 'new', 'contacted', 'followup_scheduled',
--      'converted', 'lost', 'closed' values
--   3. enrollments table: add 'assigned_to' nullable FK to users.id with
--      a partial index on (assigned_to) WHERE assigned_to IS NOT NULL so
--      the "my leads" employee-dashboard query is fast.
--
-- All statements are idempotent so this is safe to run multiple times
-- and against a database that was created via `prisma db push` (which
-- doesn't track the prior migration baseline).

-- ---------------------------------------------------------------------------
-- 1. Add 'employee' to Role enum.
--    PostgreSQL ALTER TYPE ... ADD VALUE cannot run inside a transaction
--    when the type was created in the same transaction, but is safe here
--    since the Role type was created long ago. IF NOT EXISTS handles re-runs.
-- ---------------------------------------------------------------------------
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'employee';

-- ---------------------------------------------------------------------------
-- 2. Extend FollowupStatus enum with the values the employee portal needs.
--    Order is preserved by the order of these statements; existing values
--    (payment_pending, call_back_later, etc.) stay in their original
--    positions. ADD VALUE IF NOT EXISTS makes this idempotent.
-- ---------------------------------------------------------------------------
ALTER TYPE "FollowupStatus" ADD VALUE IF NOT EXISTS 'new';
ALTER TYPE "FollowupStatus" ADD VALUE IF NOT EXISTS 'contacted';
ALTER TYPE "FollowupStatus" ADD VALUE IF NOT EXISTS 'followup_scheduled';
ALTER TYPE "FollowupStatus" ADD VALUE IF NOT EXISTS 'converted';
ALTER TYPE "FollowupStatus" ADD VALUE IF NOT EXISTS 'lost';
ALTER TYPE "FollowupStatus" ADD VALUE IF NOT EXISTS 'closed';

-- ---------------------------------------------------------------------------
-- 3. enrollments.assigned_to — nullable FK to users.id.
--    Tracks which employee owns this lead. Set when admin assigns the
--    enrollment; cleared (SET NULL) if the user is hard-deleted.
--
--    Indexed only on rows where assigned_to is populated (partial index)
--    because the "show me MY leads" employee-dashboard query is the hot
--    path; unassigned enrollments are queried by status, not by NULL.
-- ---------------------------------------------------------------------------
ALTER TABLE "enrollments"
  ADD COLUMN IF NOT EXISTS "assigned_to" UUID;

-- FK constraint — added separately so we can use IF NOT EXISTS-style guard
-- via a DO block (Postgres has no ADD CONSTRAINT IF NOT EXISTS).
DO $$ BEGIN
  ALTER TABLE "enrollments"
    ADD CONSTRAINT "enrollments_assigned_to_fkey"
    FOREIGN KEY ("assigned_to") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- Partial index on (assigned_to) — powers "my leads" lookup.
CREATE INDEX IF NOT EXISTS "enrollments_assigned_to_idx"
  ON "enrollments" ("assigned_to")
  WHERE "assigned_to" IS NOT NULL;

-- Composite partial index on (assigned_to, status) — powers the employee
-- dashboard's status-bucket counts (today / overdue / converted / lost).
CREATE INDEX IF NOT EXISTS "enrollments_assigned_to_status_idx"
  ON "enrollments" ("assigned_to", "status")
  WHERE "assigned_to" IS NOT NULL;
