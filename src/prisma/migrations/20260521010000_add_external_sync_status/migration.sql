-- Migration: add_external_sync_status
--
-- Decouples the customer-facing payment lifecycle from our internal
-- third-party sync state. Previously, when the external-API sync (Sumago
-- webhook) exhausted retries, the worker flipped `enrollments.status`
-- to 'failed' — incorrectly marking legitimately-paid customers as
-- failed in the admin UI, blocking re-enrollment attempts, and confusing
-- downstream reports.
--
-- After this migration:
--   * `enrollments.status`            — payment lifecycle only
--                                       (paid / payment_pending / failed / …)
--   * `enrollments.external_sync_status` — third-party sync state
--                                       (PENDING / SUCCESS / FAILED / DEAD_LETTER)
--
-- All NULLABLE → backward-compatible. Existing rows get NULL until they
-- are touched by a new sync attempt or the manual retry endpoint.

-- ---------------------------------------------------------------------------
-- 1. Enum type
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ExternalSyncStatus') THEN
    CREATE TYPE "ExternalSyncStatus" AS ENUM (
      'PENDING',     -- queued, not yet attempted (or in-flight)
      'SUCCESS',     -- third-party acknowledged successfully
      'FAILED',      -- a single attempt failed; retry loop continues
      'DEAD_LETTER'  -- all retries exhausted; needs manual intervention
    );
  END IF;
END$$;

-- ---------------------------------------------------------------------------
-- 2. Column on enrollments
-- ---------------------------------------------------------------------------
ALTER TABLE "enrollments"
  ADD COLUMN IF NOT EXISTS "external_sync_status" "ExternalSyncStatus";

-- ---------------------------------------------------------------------------
-- 3. Index — admin UI filters by this; partial index because most rows
--    are NULL (legacy + not-yet-synced) so a partial cover is far smaller
--    than a full index on a sparse column.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "enrollments_external_sync_status_idx"
  ON "enrollments" ("external_sync_status")
  WHERE "external_sync_status" IS NOT NULL;
