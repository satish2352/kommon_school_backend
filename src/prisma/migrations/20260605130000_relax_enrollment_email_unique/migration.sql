-- Allow repeat enrollments per email (admin-created renewals/purchases) so a
-- student's enrollment history accumulates instead of being overwritten.
--
-- Previously "uniq_enrollments_email_active" enforced AT MOST ONE non-deleted
-- enrollment per email. We replace it with a narrower rule: at most one
-- IN-PROGRESS draft (submitted / payment_pending) per email. Paid, sync_pending,
-- completed, failed and expired rows are now unlimited per email — they are the
-- history. This still prevents duplicate half-finished drafts (and keeps the
-- public resume flow's "one active draft" assumption intact) while letting the
-- admin re-enroll an existing student any number of times.
--
-- Existing data already satisfies the stricter old rule, so the narrower index
-- is guaranteed to build without conflicts.

DROP INDEX IF EXISTS "uniq_enrollments_email_active";

CREATE UNIQUE INDEX IF NOT EXISTS "uniq_enrollments_email_inprogress"
  ON "enrollments" (lower(email))
  WHERE deleted_at IS NULL AND status IN ('submitted', 'payment_pending');
