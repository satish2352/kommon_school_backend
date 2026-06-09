-- Add the `student` value to the Role enum for public self-enrolled users.
-- Additive + idempotent; safe to re-run.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'student';
