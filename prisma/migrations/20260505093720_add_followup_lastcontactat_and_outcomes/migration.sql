-- Add new InteractionOutcome enum values
ALTER TYPE "InteractionOutcome" ADD VALUE IF NOT EXISTS 'NOT_REACHABLE';
ALTER TYPE "InteractionOutcome" ADD VALUE IF NOT EXISTS 'SWITCHED_OFF';

-- Add lastContactAt to follow_ups
ALTER TABLE "follow_ups" ADD COLUMN IF NOT EXISTS "lastContactAt" TIMESTAMP(3);
