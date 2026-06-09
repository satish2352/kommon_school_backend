-- Email send audit log (onboarding + future transactional mail).
-- Idempotent so it can be applied safely whether or not the table was
-- pre-created out of band.

DO $$ BEGIN
  CREATE TYPE "EmailStatus" AS ENUM ('sent', 'failed', 'skipped');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "email_logs" (
  "id"            UUID         NOT NULL DEFAULT gen_random_uuid(),
  "to_email"      VARCHAR(255) NOT NULL,
  "type"          VARCHAR(50)  NOT NULL DEFAULT 'onboarding',
  "status"        "EmailStatus" NOT NULL,
  "message_id"    VARCHAR(255),
  "error"         TEXT,
  "subject"       VARCHAR(255),
  "reason"        VARCHAR(255),
  "enrollment_id" UUID,
  "user_id"       UUID,
  "trace_id"      VARCHAR(64),
  "triggered_by"  VARCHAR(255),
  "created_at"    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT "email_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "email_logs_to_email_idx"          ON "email_logs" ("to_email");
CREATE INDEX IF NOT EXISTS "email_logs_created_at_idx"        ON "email_logs" ("created_at" DESC);
CREATE INDEX IF NOT EXISTS "email_logs_status_idx"            ON "email_logs" ("status");
CREATE INDEX IF NOT EXISTS "email_logs_type_created_at_idx"   ON "email_logs" ("type", "created_at" DESC);
