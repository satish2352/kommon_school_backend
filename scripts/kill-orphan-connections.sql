-- Force-terminate orphaned idle Postgres connections from the `dev` user
-- in the `kommon` database, EXCEPT the current session. Use this when
-- "FATAL: sorry, too many clients already" appears after multiple backend
-- restarts left leaked connections that Postgres has not yet reaped.
SELECT
  pid,
  usename,
  application_name,
  state,
  pg_terminate_backend(pid) AS terminated
FROM pg_stat_activity
WHERE datname = 'kommon'
  AND usename = 'dev'
  AND pid <> pg_backend_pid()
  AND state IN ('idle', 'idle in transaction', 'idle in transaction (aborted)');
