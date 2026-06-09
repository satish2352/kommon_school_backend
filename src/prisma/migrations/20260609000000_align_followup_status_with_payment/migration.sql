-- Migration: align_followup_status_with_payment
--
-- Followup rows that were attached to enrollments which are now PAID
-- (either via the public payment flow or the admin "+ New Enrollment"
-- offline-payment flow) get rolled forward to the terminal status
-- 'payment_completed'. This stops them surfacing as actionable in the
-- admin Follow-Ups page when there is in fact nothing left to follow up.
--
-- Rules:
--   * Only non-terminal followups are touched. Statuses that are already
--     terminal (payment_completed / followup_closed / converted / lost /
--     closed) are left alone so historic outcomes are preserved verbatim.
--   * An enrollment counts as paid when:
--       (a) status IN ('paid', 'completed'), OR
--       (b) internal_payment_status IN ('PAID', 'FULLY_DISCOUNTED')
--     The second covers admin internal flows where status may still be
--     'submitted' transiently while the snapshot column is the source of
--     truth for "money has been collected".
--   * closed_at is set to NOW() when missing (matches the terminal-
--     transition behaviour of the followup service).
--
-- Idempotent: re-running the script after no new payments simply touches
-- zero rows.

UPDATE "followups" f
SET    "status"    = 'payment_completed',
       "closed_at" = COALESCE(f."closed_at", NOW()),
       "updated_at" = NOW()
FROM   "enrollments" e
WHERE  e."id" = f."enrollment_id"
  AND  f."deleted_at" IS NULL
  AND  f."status" NOT IN (
         'payment_completed', 'followup_closed', 'converted', 'lost', 'closed'
       )
  AND (
         e."status"::text IN ('paid', 'completed')
         OR e."internal_payment_status"::text IN ('PAID', 'FULLY_DISCOUNTED')
       );
