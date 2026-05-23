-- Migration: create_sumago_users
--
-- Persistent local cache of users fetched from the Sumago Platform
-- Integration API (GET /integrations/get-users). Previously the admin
-- "Fetch Users (GET)" page hit Sumago on every visit and discarded the
-- response. That had three problems:
--
--   1. Page was blank on first visit until the admin clicked a button.
--   2. Every visit re-downloaded the full org user list — wasteful for
--      orgs with thousands of users and slow when Sumago is degraded.
--   3. We had no historical record of what Sumago had told us about
--      any given user, so reconciliation bugs were impossible to debug.
--
-- This table is the source-of-truth for what the admin UI displays.
-- The sync routine (sumagoUserSync.service.js) inserts/updates rows by
-- email — Sumago's `userId` field is always NULL in the get-users
-- response, so email is the only stable natural key.
--
-- Idempotent: every CREATE / ALTER uses IF NOT EXISTS so re-running on
-- an already-migrated DB is a no-op.

CREATE TABLE IF NOT EXISTS "sumago_users" (
  "id"                  SERIAL          PRIMARY KEY,

  -- Natural key. Lowercased before insert (matches our enrollment join).
  -- Sumago's userId field is always null in the get-users response so
  -- we cannot use it. Email is unique per Sumago organization.
  "email"               VARCHAR(255)    NOT NULL,

  -- Identity columns
  "first_name"          VARCHAR(200),
  "last_name"           VARCHAR(200),
  "phone_number"        VARCHAR(50),

  -- Taxonomy columns mirrored from Sumago's response. We keep these as
  -- top-level columns (not just inside raw_payload) so the listing query
  -- can sort/filter without a JSON path expression.
  "plan"                VARCHAR(200),
  "group_name"          VARCHAR(200),
  "unit"                VARCHAR(200),
  "phase"               VARCHAR(200),
  "segment"             VARCHAR(200),

  -- Sumago-side lifecycle status
  "email_status"        VARCHAR(50),
  "onboarding_status"   VARCHAR(50),

  -- planHistory[] from Sumago. Kept as JSONB to preserve all fields
  -- (paymentDate / amount / plan / etc.) without a join table — we
  -- never query inside it server-side, only render on the frontend.
  "plan_history"        JSONB           NOT NULL DEFAULT '[]'::jsonb,

  -- Organisation context. organization_code is the Sumago-side org
  -- identifier; tenant_token_hash is a SHA-256 hash of the bearer
  -- token used to fetch this row, so if the env token is rotated to a
  -- different org we don't accidentally merge two orgs into one table.
  "organization_code"   VARCHAR(100),
  "tenant_token_hash"   VARCHAR(64),

  -- Forward-compat: full raw user object as Sumago returned it. If
  -- Sumago adds new fields tomorrow we still have them captured
  -- without a schema change.
  "raw_payload"         JSONB           NOT NULL,

  -- Change-detection. SHA-256 of a canonical JSON of raw_payload. We
  -- only UPDATE a row when the hash changes — saves write IO on the
  -- common "user already in our table, nothing changed" path.
  "content_hash"        CHAR(64)        NOT NULL,

  -- Bookkeeping
  "first_seen_at"       TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  "last_synced_at"      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  "updated_at"          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- Unique on email so the bulk upsert can use ON CONFLICT (email) and
-- so a corrupted double-fetch never produces duplicate user rows.
-- Case-folded (lower(email)) so 'Foo@x.com' and 'foo@x.com' collide —
-- matches the partial index on our enrollments table.
CREATE UNIQUE INDEX IF NOT EXISTS "sumago_users_email_lower_unique"
  ON "sumago_users" (LOWER("email"));

-- Listing query is "all users, newest first by last_synced_at" — this
-- composite covers the common case where the frontend asks for the
-- current org's users sorted by recency.
CREATE INDEX IF NOT EXISTS "sumago_users_org_last_synced_idx"
  ON "sumago_users" ("organization_code", "last_synced_at" DESC);

-- Tenant-hash index — for ops queries like "which rows came from this
-- token?" when investigating a token rotation incident.
CREATE INDEX IF NOT EXISTS "sumago_users_tenant_token_hash_idx"
  ON "sumago_users" ("tenant_token_hash");

-- Onboarding-status filter (admin will likely add a "Pending only"
-- filter eventually).
CREATE INDEX IF NOT EXISTS "sumago_users_onboarding_status_idx"
  ON "sumago_users" ("onboarding_status");
