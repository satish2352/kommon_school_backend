# Kommon School Backend — MVP

Student enrollment & Razorpay payment API. Express + Prisma + PostgreSQL.

## Requirements

- Node.js 20+
- PostgreSQL 15+
- A Razorpay account (test or live keys)

## Setup

```bash
# 1. Install deps
npm ci

# 2. Configure env
cp .env.example .env
# Edit .env — at minimum set:
#   DATABASE_URL
#   JWT_ACCESS_SECRET, JWT_REFRESH_SECRET (32+ chars each)
#   RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET
#   ENCRYPTION_MASTER_KEY (32 bytes hex)
#   SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD
#
# Generate ENCRYPTION_MASTER_KEY:
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 3. Run migrations
npx prisma migrate dev --name init
# (production: npx prisma migrate deploy)

# 4. Seed superadmin + Razorpay config (encrypted at rest)
npm run db:seed

# 5. Start
npm start
# or for hot-reload during development:
npm run dev
```

The server listens on `PORT` (default `3000`). Health check: `GET /health`.

## Endpoints (MVP)

### Auth
- `POST /api/v1/auth/login`        `{ email, password }`
- `POST /api/v1/auth/refresh`      `{ refreshToken }`
- `POST /api/v1/auth/logout`       (Bearer)
- `GET  /api/v1/auth/me`           (Bearer)

### Enrollments
- `POST /api/v1/enrollments`       (public)
- `GET  /api/v1/enrollments`       (admin/superadmin, paginated)
- `GET  /api/v1/enrollments/:id`   (admin/superadmin/marketing)

### Payments
- `POST /api/v1/payments/create-order`             (public)  body: `{ enrollmentId }`
- `POST /api/v1/payments/verify`                   (public)  body: `{ razorpay_order_id, razorpay_payment_id, razorpay_signature }`
- `GET  /api/v1/payments/by-enrollment/:id`        (public — frontend resume)

### Webhook
- `POST /api/v1/webhooks/razorpay`  (signature-gated, raw body)

### Health
- `GET /health`   liveness
- `GET /ready`    readiness (DB ping)

## Response envelopes

Success: `{ success: true, data, meta?, message? }`
Error:   `{ success: false, error: { code, message, details? }, traceId }`

## Scope

This is the **MVP**. Everything in the master prompt that is not in the
endpoint list above is deferred to Phase 2:

- BullMQ + Redis queues / workers
- node-cron jobs (reconciliation, cleanup, follow-up reminders, etc.)
- External API sync (`webhook.site` callout) and its retry pipeline
- Marketing follow-up module
- Reports module + CSV export
- Razorpay multi-config CRUD/switch endpoints (a single config is seeded from env)
- Admin user CRUD
- PM2 ecosystem, nginx config, systemd
- Prometheus `/metrics`
- Audit log table, external_api_logs table, role/permission tables

The schema, encryption-at-rest, RBAC middleware, race-protected payment
settlement, webhook idempotency, and traceId logging are all in place so
Phase 2 can extend without migration churn.

---

### Phase 2A: Queues + External API Sync

#### Additional requirements

- **Redis 7+** must be running before `npm start`.
  - Ubuntu/Debian: `sudo apt install redis-server && sudo systemctl enable --now redis-server`
  - macOS: `brew install redis && brew services start redis`
  - Docker: `docker run -d -p 6379:6379 redis:7-alpine`

#### New environment variables

| Variable | Default | Purpose |
|---|---|---|
| `REDIS_URL` | `redis://localhost:6379` | ioredis connection URL. Use `rediss://` for TLS. Required. |
| `EXTERNAL_API_URL` | `https://webhook.site/8012a95d-2521-4b64-b59f-1cbf3bd5e6e0` | Target endpoint for enrollment sync POST. Required. |
| `EXTERNAL_API_TOKEN` | — | Bearer token sent in `Authorization` header. Required. |
| `EXTERNAL_API_TIMEOUT_MS` | `15000` | Per-call HTTP timeout in milliseconds (min 1000). |

Copy `.env.example` → `.env` and fill in the new values.

#### Run after adding Phase 2A

```bash
# 1. Install new dependencies
npm install

# 2. Apply schema migration (adds ExternalApiLog model + sync_pending status)
npx prisma migrate dev --name add_external_api_logs

# 3. Start (Redis must be up first)
npm start
```

#### How to verify

1. Submit an enrollment: `POST /api/v1/enrollments`
2. Create an order: `POST /api/v1/payments/create-order`
3. Verify payment: `POST /api/v1/payments/verify` with valid Razorpay fields
4. After the verify call returns `{ status: 'success' }`, check:
   - `SELECT status FROM enrollments WHERE id = '<id>'` — should be `sync_pending` momentarily, then `completed` once the worker finishes.
   - `SELECT status, attempts, status_code FROM external_api_logs WHERE enrollment_id = '<id>'` — should show `success` with `status_code = 200`.
   - Server console shows `external_api_sync_success` log line.

The same enqueue happens via the Razorpay webhook path (`POST /api/v1/webhooks/razorpay` with `payment.captured` event).

#### Retry pipeline

- BullMQ retries up to **5 attempts** with exponential backoff starting at 30 s (30 s, 60 s, 120 s, 240 s, 480 s).
- After 5 failures the log row transitions to `dead_letter` and a loud error log (`external_api_dead_letter`) is emitted.
- A **Phase 2B** retry sweeper cron will reschedule rows stuck in `retrying` state (e.g. after a Redis restart). Until Phase 2B ships, BullMQ's built-in retry handles all attempts.
- 409 responses from the external API are treated as success (enrollment already synced remotely).
- 400/422 responses are terminal — the job is not retried and the log row is marked `failed`.
- Circuit breaker opens after 50% failure rate in the rolling window; resets after 30 s.

#### Rotating the external API token

1. Update `EXTERNAL_API_TOKEN` in `.env` (or your secrets manager).
2. Restart the process. No migration needed.

---

### Phase 2B: Cron Jobs

Six `node-cron` scheduled jobs run in every process instance but only execute on
**one** instance at a time thanks to Redis-backed distributed locks
(`src/utils/distributedLock.js` — SETNX + Lua-atomic release).

#### Schedules

| Job | Schedule | Description |
|---|---|---|
| `payment_reconciliation` | `*/5 * * * *` | Checks Razorpay for payments still `pending`/`initiated` in our DB after 10 min; settles captured ones, expires uncaptured ones after 30 min |
| `external_api_retry` | `*/2 * * * *` | Re-enqueues `external_api_logs` rows stuck in `retrying` state (e.g. after a Redis restart lost in-memory BullMQ jobs) |
| `webhook_retry` | `*/3 * * * *` | Replays `WebhookEvent` rows with `processed=false` and fewer than 5 attempts |
| `enrollment_cleanup` | `0 2 * * *` | Expires `submitted` enrollments older than 24 h (configurable via `ENROLLMENT_CLEANUP_STALE_HOURS`) |
| `refresh_token_cleanup` | `0 3 * * *` | Hard-deletes expired/revoked `RefreshToken` rows older than 30 days (configurable via `REFRESH_TOKEN_CLEANUP_RETENTION_DAYS`) |
| `followup_reminder` | `0 9 * * *` | **Phase 2C stub — intentional no-op.** Logs `followup_reminder_job_skipped_pending_phase_2c` until the followups table and marketing module land in Phase 2C |

All schedules run in UTC by default. Set `CRON_TIMEZONE` env var to a valid tz
string (e.g. `Asia/Kolkata`) to run daily jobs in local time.

#### New optional environment variables (no new required vars)

| Variable | Default | Purpose |
|---|---|---|
| `RECONCILIATION_PENDING_GRACE_MS` | `600000` (10 min) | Minimum age of a pending payment before reconciliation checks Razorpay |
| `RECONCILIATION_EXPIRE_AFTER_MS` | `1800000` (30 min) | Age after which an uncaptured pending payment is marked `expired` |
| `ENROLLMENT_CLEANUP_STALE_HOURS` | `24` | Hours a `submitted` enrollment may be idle before expiry |
| `REFRESH_TOKEN_CLEANUP_RETENTION_DAYS` | `30` | Days to retain expired/revoked refresh tokens for audit before hard-delete |
| `WEBHOOK_RETRY_MAX_ATTEMPTS` | `5` | Maximum replay attempts per failed webhook event |
| `WEBHOOK_RETRY_BATCH_SIZE` | `50` | Max rows processed per webhook_retry tick |
| `EXTERNAL_API_RETRY_BATCH_SIZE` | `50` | Max rows rescheduled per external_api_retry tick |
| `CRON_TIMEZONE` | `UTC` | IANA timezone for daily cron schedules |

Redis is already required by Phase 2A; no new infrastructure dependencies.

#### Run after adding Phase 2B

```bash
# 1. Install new dependency (node-cron)
npm install

# 2. No migration needed — Phase 2B adds no new DB tables
# 3. Start (Redis must be up first)
npm start
```

Job activity is visible in structured logs:

```
job_started   { job, timestamp }
job_completed { job, duration_ms, ...counts }
job_skipped   { job, duration_ms, reason: "lock_held_by_another_instance" }
job_failed    { job, duration_ms, error }
jobs_started  { count }
jobs_stopped  { count }
```

---

### Phase 2C: Follow-ups

Marketing follow-up module — lets the marketing team manage the lifecycle of
enrollments whose external-API sync permanently failed (dead-letter).

#### New database tables

| Table | Purpose |
|---|---|
| `followups` | One record per enrollment that needs follow-up; tracks status, assignee, next contact date |
| `followup_notes` | Timeline notes attached to a followup (user-authored and system-generated) |

Run migration after deploying this phase:

```bash
npx prisma migrate dev --name add_followups
# production:
npx prisma migrate deploy
```

#### Endpoints

All five endpoints require a valid Bearer token and one of the roles:
`marketing`, `admin`, or `superadmin`.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/followups` | List followups. Query: `page`, `limit`, `sortBy` (`created_at`\|`updated_at`\|`next_followup_date`\|`status`), `sortOrder`, `search`, `status`, `assignedTo` (UUID), `dateFrom`, `dateTo` |
| `GET` | `/api/v1/followups/:id/timeline` | Followup detail + synthesized timeline (creation event, notes, payment events) sorted chronologically |
| `POST` | `/api/v1/followups/:id/notes` | Append a note. Body: `{ body: string (max 5000), metadata?: object }` |
| `PATCH` | `/api/v1/followups/:id/status` | Transition status. Body: `{ status: FollowupStatus, next_followup_date?: ISO date }` |
| `POST` | `/api/v1/followups/:id/retry-payment` | Trigger a Razorpay payment retry for the linked enrollment. Returns order details for the marketing UI checkout flow. |

NOTE: `POST /api/v1/payments/:id/retry` (mentioned in the master spec) is **not**
implemented. Payment retries are followup-scoped (`/followups/:id/retry-payment`)
since the marketing lifecycle context lives in the followup, not the payment.

#### FollowupStatus values

`payment_pending` | `call_back_later` | `interested` | `not_interested` |
`payment_completed` | `followup_closed` | `invalid_number` | `no_response`

`payment_completed` and `followup_closed` are **terminal** — no further status
transitions are allowed once a followup reaches either state (returns `409
FOLLOWUP_INVALID_TRANSITION`).

#### Auto-creation on dead-letter

When the BullMQ external-api-sync worker exhausts all retry attempts, the worker:

1. Marks the `external_api_log` row as `dead_letter`.
2. Sets `enrollment.status = 'failed'`.
3. Calls `followupService.autoCreateFromDeadLetter({ enrollmentId, reason, traceId })`.
   This is **idempotent** — if an active followup already exists for the enrollment,
   the existing record is returned unchanged. Followup-creation failure is caught
   and logged (`followup_auto_create_failed`) and does **not** crash the worker.

#### Follow-up reminder cron (daily at 09:00 UTC)

The `followup_reminder` cron job (Phase 2B stub replaced with real logic) queries
followups where:
- `next_followup_date <= NOW()`
- status not in (`payment_completed`, `followup_closed`)
- `assigned_to IS NOT NULL`
- `deleted_at IS NULL`

Results are grouped by `assigned_to` and logged as structured entries
(`followup_reminder_due`, `assignee_id`, `count`, `ids`). No email or SMS is sent
yet — notification transport is out of scope for Phase 2C. Operations and
marketing teams monitor the log stream directly.

#### How to start after Phase 2C

```bash
# 1. Apply the schema migration
npx prisma migrate dev --name add_followups

# 2. Start (Redis must already be up)
npm start
```

---

### Phase 2D: Admin Module + Audit Logs

Superadmin-only CRUD for users and Razorpay configurations, read-only external API log
viewer for admin/superadmin, and a persistent audit log table with middleware integration.

#### New database table

| Table | Purpose |
|---|---|
| `audit_logs` | Immutable record of every privileged action: actor, action, entity, IP, user-agent, traceId |

Run migration after deploying this phase:

```bash
npx prisma migrate dev --name add_audit_logs
# production:
npx prisma migrate deploy
```

#### Endpoint groups

**Admin users** — `superadmin` only

| Method | Path | Description |
|---|---|---|
| `POST`   | `/api/v1/admin/users`       | Create a user. Body: `{ email, password (min 8), role (admin\|marketing\|superadmin) }` |
| `GET`    | `/api/v1/admin/users`       | List users. Query: `page`, `limit`, `sortBy`, `sortOrder`, `search`, `role`, `status` (active\|deleted) |
| `GET`    | `/api/v1/admin/users/:id`   | Get a single user (no password hash returned) |
| `PATCH`  | `/api/v1/admin/users/:id`   | Update `role` and/or `password`. Cannot modify your own account (409 `CANNOT_MODIFY_SELF`) |
| `DELETE` | `/api/v1/admin/users/:id`   | Soft-delete + revoke all refresh tokens. Cannot delete yourself (409 `CANNOT_MODIFY_SELF`) |

**Razorpay configurations** — `superadmin` only

| Method | Path | Description |
|---|---|---|
| `POST`   | `/api/v1/admin/razorpay-configs`              | Create config. Body: `{ key_id, key_secret, webhook_secret }`. Stored encrypted; `is_active=false` by default |
| `GET`    | `/api/v1/admin/razorpay-configs`              | List configs. Secrets never returned |
| `GET`    | `/api/v1/admin/razorpay-configs/:id`          | Get config (masked) |
| `PATCH`  | `/api/v1/admin/razorpay-configs/:id/activate` | Atomically activate a config (deactivates all others in one transaction) |
| `DELETE` | `/api/v1/admin/razorpay-configs/:id`          | Hard-delete. Refuses with 409 `CANNOT_DELETE_ACTIVE` if the config is currently active |

**External API logs** — `admin` or `superadmin`

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/admin/external-api-logs`      | List logs. Query: `page`, `limit`, `sortBy`, `sortOrder`, `status`, `enrollmentId`, `dateFrom`, `dateTo` |
| `GET` | `/api/v1/admin/external-api-logs/:id`  | Get single log with full `request_body` / `response_body` payloads |

**Audit logs** — `admin` or `superadmin`

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/audit-logs` | List audit events. Query: `page`, `limit`, `sortBy`, `sortOrder`, `search`, `action`, `entityType`, `entityId`, `actorId`, `dateFrom`, `dateTo` |

#### Audit logging coverage

The following actions are now automatically written to `audit_logs`:

| Action | Trigger |
|---|---|
| `auth.login` | Successful login |
| `auth.logout` | Explicit logout |
| `user.create` | Superadmin creates a user |
| `user.update` | Superadmin updates a user |
| `user.delete` | Superadmin soft-deletes a user |
| `razorpay_config.create` | Superadmin creates a config |
| `razorpay_config.activate` | Superadmin activates a config |
| `razorpay_config.delete` | Superadmin deletes a config |
| `followup.status_change` | Any role transitions a followup status |
| `followup.payment_retry` | Any role triggers a payment retry |

Audit log writes are fire-and-forget — a write failure is logged but never
propagates to the caller. No action is blocked due to audit log unavailability.

#### New error codes

| Code | HTTP | Meaning |
|---|---|---|
| `CANNOT_MODIFY_SELF` | 409 | Actor attempted to modify or delete their own account |
| `CANNOT_DELETE_ACTIVE` | 409 | Attempted to delete the currently active Razorpay configuration |

#### How to start after Phase 2D

```bash
# 1. Apply the schema migration
npx prisma migrate dev --name add_audit_logs

# 2. Start (Redis must already be up)
npm start
```

---

### Phase 2E: Reports

Read-only reporting endpoints for payments, enrollment funnel, external API
health, and a streaming CSV export. All four endpoints require a valid Bearer
token and role `admin` or `superadmin`.

#### New dependency

```bash
npm install
```

`csv-stringify ^6.5.0` was added to `dependencies`. No migration is needed —
this phase queries existing tables only.

#### Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/reports/payments-summary` | Aggregate payment counts and amounts grouped by status. Total amount only counts `success` payments. |
| `GET` | `/api/v1/reports/enrollments-funnel` | Count of enrollments in each of the 7 `EnrollmentStatus` values. Zero-count stages are always included. |
| `GET` | `/api/v1/reports/external-api-health` | Count per `ExternalApiStatus`, the 50 most-recent dead-letter rows, and average attempts/duration for successful calls. |
| `GET` | `/api/v1/reports/export` | Stream a CSV file. Required query param: `type=payments`. Optional: `format=csv` (default). |

All endpoints accept optional `dateFrom` and `dateTo` ISO-8601 date query
parameters to narrow the result window. When both are supplied `dateTo` must
be greater than or equal to `dateFrom`.

#### Example requests

Payments summary for a date range:

```
GET /api/v1/reports/payments-summary?dateFrom=2026-01-01&dateTo=2026-12-31
Authorization: Bearer <token>
```

Download CSV export (curl saves the file):

```bash
curl -H "Authorization: Bearer <token>" \
  "http://localhost:3000/api/v1/reports/export?type=payments&dateFrom=2026-01-01&dateTo=2026-12-31" \
  -o payments-export.csv
```

#### CSV columns

`payment_id`, `order_id`, `razorpay_payment_id`, `status`, `amount_paise`,
`amount_inr`, `currency`, `created_at`, `enrollment_email`,
`enrollment_first_name`, `enrollment_last_name`, `enrollment_phone`, `plan`

`amount_inr` is `amount_paise / 100` rounded to two decimal places.

#### New error code

| Code | HTTP | Meaning |
|---|---|---|
| `UNSUPPORTED_REPORT_TYPE` | 400 | `type` query param is not one of the supported report types |

#### How to start after Phase 2E

```bash
# 1. Install new dependency
npm install

# 2. No migration needed
# 3. Start (Redis must already be up)
npm start
```

---

### Phase 2F: Granular RBAC + RS256 JWT

Role-level permissions replace the coarse `authorize([...])` checks on
protected routes. JWT signing supports RS256 (asymmetric) in addition to
the existing HS256 (symmetric) mode.

#### New database tables

| Table | Purpose |
|---|---|
| `permissions` | Master list of permission codes and human-readable descriptions |
| `role_permissions` | Many-to-many join: Role enum value to permission ID |

Run migration after deploying this phase:

```bash
npx prisma migrate dev --name add_permissions
# production:
npx prisma migrate deploy
```

#### Permission codes

| Code | superadmin | admin | marketing |
|---|---|---|---|
| `enrollments:view` | yes | yes | yes |
| `payments:view` | yes | yes | no |
| `payments:retry` | yes | no | yes |
| `followups:view` | yes | yes | yes |
| `followups:manage` | yes | no | yes |
| `razorpay_configs:manage` | yes | no | no |
| `users:manage` | yes | no | no |
| `reports:view` | yes | yes | no |
| `external_api_logs:view` | yes | yes | no |
| `audit_logs:view` | yes | yes | no |

Superadmin always bypasses the DB check in middleware — the middleware
short-circuits on `role === 'superadmin'`. Superadmin rows are still seeded
for completeness and auditing purposes.

#### New endpoint

| Method | Path | Permission | Description |
|---|---|---|---|
| `POST` | `/api/v1/payments/:id/retry` | `payments:retry` | Retry a payment by payment ID. Returns Razorpay order details. |

#### RS256 migration (production-recommended)

HS256 remains the default. To switch to RS256:

1. Generate key pairs:

```bash
openssl genrsa -out access-private.pem 2048
openssl rsa -in access-private.pem -pubout -out access-public.pem
openssl genrsa -out refresh-private.pem 2048
openssl rsa -in refresh-private.pem -pubout -out refresh-public.pem
```

2. Set env vars (store keys outside the repo, reference them by path):

```
JWT_ALGORITHM=RS256
JWT_ACCESS_PRIVATE_KEY_PATH=/etc/kommon/access-private.pem
JWT_ACCESS_PUBLIC_KEY_PATH=/etc/kommon/access-public.pem
JWT_REFRESH_PRIVATE_KEY_PATH=/etc/kommon/refresh-private.pem
JWT_REFRESH_PUBLIC_KEY_PATH=/etc/kommon/refresh-public.pem
```

3. Force-logout all users (revoke all refresh tokens) before deploying to avoid
   HS256 tokens being verified with the RS256 public key.

4. Remove `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` from production env once
   the fleet has fully rotated to RS256.

#### How to start after Phase 2F

```bash
# 1. Apply the schema migration
npx prisma migrate dev --name add_permissions

# 2. Re-seed (idempotent — safe to re-run)
npm run db:seed

# 3. Start (Redis must already be up)
npm start
```

#### In-process permission cache

The `hasPermission` middleware caches DB lookups per role for 60 seconds.
Cache is evicted automatically on TTL expiry. To force immediate eviction
(e.g. after a manual DB change without re-seeding), restart the process or
call `clearPermissionCache()` from an admin script.

---

## Deployment

### Prerequisites (Ubuntu 22.04)

```bash
# Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# PostgreSQL 15
sudo apt install -y postgresql postgresql-contrib

# Redis 7
sudo apt install -y redis-server
sudo systemctl enable --now redis-server

# Build tools (for native npm modules)
sudo apt install -y build-essential python3
```

### PM2 setup (production deploy)

```bash
# 1. Install production dependencies only
npm ci --omit=dev

# 2. Apply pending database migrations
npx prisma migrate deploy

# 3. Seed superadmin and initial Razorpay config
npm run db:seed

# 4. Start the cluster with PM2
npm run start:prod
# Equivalent: pm2 start ecosystem.config.js --env production

# Persist PM2 process list across reboots
pm2 save

# Generate and run the systemd autostart command printed by:
pm2 startup
# Then copy-paste and run the sudo command it prints.
```

### Log rotation

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 20M
pm2 set pm2-logrotate:retain 14
```

Logs are written to `logs/pm2-out.log` and `logs/pm2-error.log` as configured
in `ecosystem.config.js`.

### Nginx

```bash
# Copy the sample config and edit server_name + TLS cert paths
sudo cp nginx.conf.sample /etc/nginx/sites-available/kommon
sudo ln -sf /etc/nginx/sites-available/kommon /etc/nginx/sites-enabled/kommon

# Validate and reload
sudo nginx -t && sudo systemctl reload nginx
```

TLS via certbot (Let's Encrypt):

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d api.yourdomain.com
```

Certbot automatically edits the nginx config to add TLS certificates and sets
up auto-renewal via a systemd timer.

### Operational commands

| Command | Purpose |
|---|---|
| `pm2 logs kommon-api` | Tail live application logs |
| `pm2 reload kommon-api` | Zero-downtime rolling restart (uses SIGTERM + drain) |
| `pm2 monit` | Interactive real-time CPU / memory dashboard |
| `pm2 flush` | Clear all PM2 log files |
| `pm2 status` | Show process list with uptime and restart count |

### Running tests

```bash
npm test
# Runs: node --test src/tests/unit
# Executes rbac.test.js, retryHandler.test.js, and envelope.test.js.
# No live database or Redis required — all tests are pure in-process.
```

### OpenAPI spec

The full API specification is at `src/docs/openapi.yaml` (OpenAPI 3.0.3).
Load it in Swagger UI, Postman, or any compatible client:

```bash
# Quick preview with npx (no install):
npx @redocly/cli preview-docs src/docs/openapi.yaml
```

---

### Production checklist

- [ ] All env vars in `.env` / secrets manager set to real values — no placeholder defaults
- [ ] `JWT_ALGORITHM=RS256` configured with 2048-bit PEM key pairs stored outside the repo
- [ ] `ENCRYPTION_MASTER_KEY` rotated to a real 32-byte hex value (not all zeros)
- [ ] Razorpay live keys uploaded via admin UI (`POST /api/v1/admin/razorpay-configs`) and activated (`PATCH /api/v1/admin/razorpay-configs/:id/activate`)
- [ ] `CORS_ALLOWED_ORIGINS` restricted to your actual frontend domain(s)
- [ ] `pm2 reload kommon-api` zero-downtime verified in staging before production
- [ ] `/health` and `/ready` reachable from load balancer health checks
- [ ] Nginx TLS configuration verified (`ssl_protocols TLSv1.2 TLSv1.3` only)
- [ ] `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` changed from defaults and rotated post-seed
- [ ] Log files excluded from version control (`.gitignore` includes `logs/`)
- [ ] `audit_logs` table reviewed weekly for anomalous privileged actions

### Phase 3B: Admin frontend adapter

Five new endpoints that serve the existing React admin pages. No new DB tables; all queries read from existing data.

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET | /api/v1/admin/dashboard | reports:view | Today enrollment + revenue counters and pending payment/follow-up counts |
| GET | /api/v1/admin/enrollments | enrollments:view | Paginated enrollment list (page, limit, search, status, dateFrom, dateTo) |
| GET | /api/v1/admin/payments | payments:view | Paginated payment list (page, limit, status, dateFrom, dateTo) |
| GET | /api/v1/admin/payments/failed | payments:view | Payments with status failed, expired, or cancelled |
| GET | /api/v1/admin/follow-ups/report | followups:view | Paginated follow-up report (page, limit, status, assignedTo, dateFrom, dateTo) |

The existing GET /api/v1/admin/external-api-logs response was also reshaped from snake_case to camelCase (enrollmentId, statusCode, lastError, durationMs, createdAt, updatedAt) with status uppercased.

Status mapping (lowercase DB -> UPPERCASE frontend):
- success -> SUCCESS, failed -> FAILED, expired -> EXPIRED, pending -> PENDING
- initiated -> CREATED, cancelled -> FAILED, refunded -> REFUNDED, partial -> PARTIAL
