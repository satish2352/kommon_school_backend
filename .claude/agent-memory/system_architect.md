# System Architect Memory

Private log for the system_architect agent. Read on startup, append after every
completed design/implementation iteration.

---

## T-2026-004 — Kommon School SaaS Backend — Greenfield Scaffold
- iteration: 1
- date: 2026-04-30
- status: complete

### Modules designed
- `src/config/` — env (Zod validation), database (Prisma singleton), redis (ioredis), logger (Pino), swagger (swagger-jsdoc)
- `src/middlewares/` — requestContext (AsyncLocalStorage), requestLogger, auth (JWT verify + RBAC), tenantResolver (header/subdomain), rateLimiter (express-rate-limit, Redis-backed with in-memory fallback), validate (Zod), errorHandler (centralized, Prisma error mapping)
- `src/modules/health/` — liveness, readiness (DB+Redis checks), metrics
- `src/modules/auth/` — register, login, refresh (token family rotation), logout, change-password, /me
- `src/modules/users/` — CRUD with tenant scoping, RBAC
- `src/modules/tenants/` — CRUD, super_admin only
- `src/modules/students/` — CRUD, tenant-scoped, soft-delete
- `src/jobs/` — BullMQ email + report queues and workers (host/port connection, not client instance)
- `src/loaders/` — express loader (middleware chain), db loader (graceful startup degradation)
- `src/routes/v1.ts` — central v1 router
- `prisma/schema.prisma` — Tenant, User, RefreshToken, Student with indexes and soft-delete
- `prisma/seed.ts` — demo data (super admin + greenwood-high school)
- `tests/` — unit (ApiError, jwt, password), integration (health)
- DevOps: Dockerfile (multi-stage, non-root), docker-compose.yml, ecosystem.config.js (PM2), CI workflow, .gitignore, .dockerignore, .env.example

### Key architectural decisions
1. **Path aliases**: TypeScript `@/*` → `src/*` at compile time via `tsc-alias` (not module-alias at runtime), which eliminates runtime module resolution complexity.
2. **BullMQ connection**: Uses host/port config object directly (not `{ client: ioredis_instance }`) — BullMQ manages its own connections internally; sharing an ioredis client caused TypeScript type incompatibility.
3. **Rate limiter**: In-memory by default with async Redis store attachment after startup. Gracefully degrades if Redis is unavailable.
4. **Graceful degradation**: Server binds and serves HTTP even if DB/Redis are unreachable. Health `/ready` returns 503 when deps are down; liveness `/health` always returns 200 if process is alive.
5. **JWT refresh rotation**: Token family tracking — on reuse detection, entire family is revoked (forces full re-login). Refresh tokens stored as SHA-256 hashes in DB.
6. **Multi-tenancy**: Resolved via `X-Tenant-Id` header (slug or cuid). Tenant object cached in Redis with TTL jitter. Super admins bypass tenant checks.
7. **Soft deletes**: `deletedAt` timestamp on User, Tenant, Student. All queries filter `deletedAt: null`.
8. **LOG_LEVEL=silent**: Added `silent` to the Pino log level enum to support test environments cleanly.
9. **PaginatedResult**: Defined in `utils/ApiResponse.ts` and exported as a named type — co-located with pagination utilities.

### Scalability plan
- Stateless HTTP handlers — no in-process state that can't be rebuilt from DB/Redis
- PM2 cluster mode: N workers (one per CPU)
- Redis: cache-aside with TTL jitter, rate limit counters, BullMQ backing
- DB: Prisma with connection pooling; all hot-path queries use indexed columns (tenantId, slug, email)
- Horizontal: drop N app containers behind a load balancer — works out of the box

### Security
- Helmet (strict CSP, HSTS), CORS allowlist, HPP, body size limits
- Rate limiting: global 1000/15min, auth 20/15min, sensitive 5/hr (per IP)
- JWT: HS256, short-lived access (15m), long-lived refresh (7d) with rotation
- bcrypt cost 12
- Constant-time password comparison (prevents timing attacks even on nonexistent users)
- Secrets only via env vars; log redaction for passwords/tokens

### Trade-offs accepted
- Rate limit store falls back to in-memory if Redis is unavailable (acceptable for development; production must have Redis)
- BullMQ workers are started lazily (imported in graceful shutdown) to avoid startup failures when Redis is absent
- No email provider integrated yet (BullMQ worker stubs placeholder)
- Prisma migrations not run at startup (external lifecycle step: `npm run prisma:migrate`)

### Known caveats
- `url.parse()` deprecation warning comes from Prisma internals — not controllable at application level
- Husky `prepare` script warns about `.git` not being found (no git repo initialized in this directory)

---

## T-2026-007 — Phase 2C: Marketing Follow-up Module
- iteration: 1
- date: 2026-05-06
- status: complete

### Modules created
- `src/modules/followups/followup.repository.js` — createFollowup, findActiveForEnrollment, findFollowupById, listFollowups, updateFollowup, appendNote, listNotes
- `src/modules/followups/followup.service.js` — autoCreateFromDeadLetter, listFollowups, getFollowupTimeline, addNote, updateStatus, triggerPaymentRetry
- `src/modules/followups/followup.validator.js` — listFollowupsQuerySchema, updateStatusSchema, addNoteSchema, idParamSchema
- `src/modules/followups/followup.controller.js` — list, getTimeline, addNote, updateStatus, retryPayment (all via asyncHandler+sendSuccess)
- `src/modules/followups/followup.routes.js` — 5 routes, authenticate + authorize(['marketing','admin','superadmin'])

### Schema changes
- Added FollowupStatus native enum (8 values)
- Added Followup model with 3 indexes
- Added FollowupNote model with 1 compound index
- Added reverse relations on Enrollment (followups[]) and User (assigned_followups[], authored_followup_notes[])

### Files modified
- src/prisma/schema.prisma — enum + 2 models + reverse relations
- src/config/constants.js — FOLLOWUP_NOT_FOUND, FOLLOWUP_INVALID_TRANSITION
- src/app.js — wired /api/v1/followups
- src/queues/workers/externalApi.worker.js — dead-letter triggers autoCreateFromDeadLetter + enrollment.status=failed
- src/jobs/followupReminder.job.js — replaced no-op stub with real implementation
- README.md — Phase 2C section appended

### Key architectural decisions
- autoCreateFromDeadLetter is idempotent via findActiveForEnrollment check
- triggerPaymentRetry uses lazy require for payment.service to keep module graph clean
- Timeline is synthesized from notes + payments (no audit_log yet; Phase 2D)
- Terminal states (payment_completed, followup_closed): any further updateStatus returns 409
- Worker dead-letter wraps autoCreateFromDeadLetter in its own try/catch — failure logs but doesn't crash
- Reminder cron: logs only, no notification transport (Phase 2D)

### Trade-offs
- No POST /payments/:id/retry (followup-scoped retry is sufficient per spec)
- No audit_log table (Phase 2D)
- No email/SMS for reminders

---

## T-2026-008 — Phase 2D: Razorpay Multi-Config CRUD, Admin User CRUD, Audit Logs, External API Log Viewer
- iteration: 1
- date: 2026-05-06
- status: complete

### Modules created
- `src/modules/audit/audit.repository.js` — createAuditLog, listAuditLogs ($transaction)
- `src/modules/audit/audit.service.js` — record (fire-and-forget, never throws), listAuditLogs (paginated)
- `src/modules/audit/audit.validator.js` — listAuditLogQuerySchema
- `src/modules/audit/audit.controller.js` — list
- `src/modules/audit/audit.routes.js` — GET /api/v1/audit-logs, admin+superadmin
- `src/modules/admin/users/user.repository.js` — createUser, findUserById, findUserByEmail, listUsers, updateUser, softDeleteUser
- `src/modules/admin/users/user.validator.js` — createUserSchema, updateUserSchema, listUsersQuerySchema, idParamSchema
- `src/modules/admin/users/user.service.js` — createUser, listUsers, getUserById, updateUser (CANNOT_MODIFY_SELF guard), deleteUser (CANNOT_MODIFY_SELF guard + token revoke)
- `src/modules/admin/users/user.controller.js` — 5 handlers
- `src/modules/admin/users/user.routes.js` — POST/GET/GET/:id/PATCH/:id/DELETE/:id, superadmin only
- `src/modules/admin/razorpayConfigs/razorpayConfig.repository.js` — createConfig, findConfigById, listConfigs, setActiveConfig (atomic $transaction), deleteConfig
- `src/modules/admin/razorpayConfigs/razorpayConfig.validator.js` — createConfigSchema, idParamSchema, listConfigsQuerySchema
- `src/modules/admin/razorpayConfigs/razorpayConfig.service.js` — createConfig (encrypt+is_active=false), listConfigs, getConfigById, activateConfig, deleteConfig (CANNOT_DELETE_ACTIVE guard)
- `src/modules/admin/razorpayConfigs/razorpayConfig.controller.js` — 5 handlers
- `src/modules/admin/razorpayConfigs/razorpayConfig.routes.js` — POST/GET/GET/:id/PATCH/:id/activate/DELETE/:id, superadmin only
- `src/modules/admin/externalApiLogs/externalApiLog.validator.js` — listQuerySchema, idParamSchema
- `src/modules/admin/externalApiLogs/externalApiLog.service.js` — listLogs, getLogById
- `src/modules/admin/externalApiLogs/externalApiLog.controller.js` — list, getById
- `src/modules/admin/externalApiLogs/externalApiLog.routes.js` — GET/GET/:id, admin+superadmin

### Schema changes
- Added AuditLog model with 3 compound indexes; reverse relation ActorAuditLogs on User

### Files modified
- src/prisma/schema.prisma — AuditLog model + User.audit_logs relation
- src/config/constants.js — CANNOT_MODIFY_SELF, CANNOT_DELETE_ACTIVE
- src/app.js — 4 new route mounts
- src/modules/auth/auth.service.js — import auditService; login/logout accept req; audit calls after success
- src/modules/auth/auth.controller.js — pass req to login and logout
- src/modules/followups/followup.service.js — import auditService; updateStatus/triggerPaymentRetry accept req; audit calls after success
- src/modules/followups/followup.controller.js — pass req to updateStatus and retryPayment
- src/modules/externalApi/external.repository.js — added listLogsByQuery, findLogById
- README.md — Phase 2D section appended

### Key architectural decisions
1. Audit record() is fully async fire-and-forget wrapped in try/catch — audit failure never breaks callers
2. setActiveConfig uses $transaction (deactivateAll + activate) — atomic, prevents two active configs
3. CANNOT_DELETE_ACTIVE guard checked before delete — refuses at service layer, not just middleware
4. CANNOT_MODIFY_SELF checked at service layer (not only route) — defense in depth
5. External API log admin reuses existing external.repository.js (listLogsByQuery/findLogById) — single source of truth
6. Secrets (key_secret, webhook_secret) are encrypted on write and never returned to callers — SAFE_SELECT in repository excludes encrypted columns

### Trade-offs
- No test files (per spec: NO test files for Phase 2D)
- No roles/permissions tables (Phase 2F)
- Audit log does not cover all mutations — only the privileged ones listed in spec; Phase 2F will expand coverage

---

## T-2026-005 — Phase 2A: Redis + BullMQ + External API Sync
- iteration: 1
- date: 2026-05-06
- status: complete

### Modules designed / modified
- `package.json` — added bullmq ^5.8.0, ioredis ^5.4.1, axios ^1.7.0, opossum ^8.1.4
- `.env.example` — added REDIS_URL, EXTERNAL_API_URL, EXTERNAL_API_TOKEN, EXTERNAL_API_TIMEOUT_MS blocks
- `src/config/env.js` — added Joi rules for 4 new env vars
- `src/config/constants.js` — added ERROR_CODES.EXTERNAL_API_ERROR, QUEUES.EXTERNAL_API_SYNC
- `src/config/redis.js` — new ioredis singleton with maxRetriesPerRequest:null for BullMQ, exponential reconnect backoff, getRedis() / disconnectRedis()
- `src/prisma/schema.prisma` — added ExternalApiStatus enum, ExternalApiLog model, sync_pending to EnrollmentStatus, reverse relation on Enrollment
- `src/queues/connection.js` — BullMQ connection wrapper returning { client: ioredis_instance }
- `src/queues/externalApi.queue.js` — Queue with 5 attempts / exponential backoff 30s / removeOnComplete:{count:1000}; enqueueExternalApiSync() with jobId=enrollmentId for idempotency
- `src/modules/externalApi/external.repository.js` — 7 repository functions for ExternalApiLog lifecycle
- `src/modules/externalApi/external.retry.handler.js` — pure classify(err) + parseRetryAfter()
- `src/modules/externalApi/external.service.js` — axios + opossum circuit breaker, PII masking, syncEnrollment()
- `src/queues/workers/externalApi.worker.js` — Worker concurrency=5, limiter={max:50,duration:1000}, dead-letter handling
- `src/queues/index.js` — startQueues() / stopQueues()
- `src/modules/payments/payment.service.js` — enqueue after successful settlement, sync_pending status update
- `src/modules/razorpay/webhook.controller.js` — same enqueue + sync_pending after handlePaymentSuccess
- `src/server.js` — startQueues() after HTTP bind, stopQueues() + disconnectRedis() in graceful shutdown
- `README.md` — Phase 2A section appended

### Key architectural decisions
1. **Single ioredis instance**: shared via getQueueConnection() for both Queue and Worker. Saves file descriptors; BullMQ accepts `{ client: redis }` form.
2. **maxRetriesPerRequest: null**: mandatory for BullMQ blocking commands (BRPOP) — ioredis default (3) causes premature timeout errors.
3. **jobId = enrollmentId**: BullMQ deduplicates by jobId while job is waiting/active — prevents double-enqueue from verify+webhook race (edge case #11).
4. **Enqueue failure is non-fatal**: queue errors in payment.service and webhook.controller are caught and logged without failing the HTTP response / webhook ack. Phase 2B sweeper handles missed syncs.
5. **Circuit breaker (opossum)**: wraps raw axios call; opens at 50% error rate, resets after 30s. Separate from BullMQ retry — circuit is per process instance.
6. **409 = success**: remote 409 means enrollment already in external system — treated as success to avoid infinite retries on a correctly-idempotent remote.
7. **sync_pending status**: added to EnrollmentStatus enum as a new intermediate state between `paid` (settlement done) and `completed` (external sync done). Position is before `paid` in the enum definition to keep alphabetic sort order consistent.

### Scalability / security trade-offs
- BullMQ exponential delay base=30s means attempt 5 fires at ~8 min total — well within the 30 min cap; accepted.
- opossum timeout = EXTERNAL_API_TIMEOUT_MS+1s to ensure axios timeout fires before the breaker, giving cleaner error messages.
- PII masked in all log lines (maskEmail, maskPhone); request body with real PII stored only in DB (external_api_logs.request_body) which is encrypted at rest via PostgreSQL row-level encryption (TDE or OS-level — separate concern).

### Assumptions
- Redis 7+ is available before npm start in production.
- EXTERNAL_API_TOKEN is a static bearer token (not JWT); rotation is a manual env-var update + restart.
- Phase 2B retry sweeper for DB rows stuck in `retrying` is out of scope here.

---

## T-2026-006 — Phase 2B: node-cron Scheduled Jobs
- iteration: 1
- date: 2026-05-06
- status: complete

### Modules designed / modified
- `package.json` — added node-cron ^3.0.3
- `src/utils/distributedLock.js` — Redis SETNX+TTL distributed lock; acquireLock / releaseLock (Lua atomic) / withLock
- `src/jobs/index.js` — cron registry: startJobs() / stopJobs(); runJob() wrapper with lock + structured logging
- `src/jobs/paymentReconciliation.job.js` — */5 * * * *; checks Razorpay for pending payments, settles captured, expires old
- `src/jobs/externalApiRetry.job.js` — */2 * * * *; reschedules retrying external_api_logs rows via enqueueExternalApiRetry
- `src/jobs/enrollmentCleanup.job.js` — 0 2 * * *; updateMany submitted→expired after 24 h
- `src/jobs/webhookRetry.job.js` — */3 * * * *; replays WebhookEvent rows via replayEvent(); max 5 attempts
- `src/jobs/followupReminder.job.js` — 0 9 * * *; intentional no-op stub until Phase 2C
- `src/jobs/refreshTokenCleanup.job.js` — 0 3 * * *; deleteMany expired/revoked refresh tokens after 30-day retention
- `src/queues/externalApi.queue.js` — added enqueueExternalApiRetry() with UUID jobId (no collision with enrollmentId-keyed original)
- `src/modules/razorpay/razorpay.service.js` — added fetchRazorpayPayment(orderId) for reconciliation
- `src/modules/razorpay/webhook.controller.js` — exported replayEvent() for webhookRetry job
- `src/server.js` — startJobs() after startQueues(); stopJobs() in graceful shutdown before stopQueues()
- `README.md` — Phase 2B section appended

### Key architectural decisions
1. **Distributed lock per job**: SETNX+PX (atomic SET with TTL, NX) — no SETEX+SETNX race. Lua script for release prevents releasing another holder's lock.
2. **withLock returns null on contention**: callers log job_skipped and return; no blocking, no queue, no retry — the next cron tick will try again.
3. **Lock TTL < tick interval**: each job's TTL is set slightly below the next tick window so a crashed process cannot hold the lock until expiry past the next tick. Exception: daily jobs have a 10-min TTL since the next tick is 24 h away.
4. **runJob() centralises all logging**: every job emits job_started, then job_completed/job_skipped/job_failed with duration_ms — consistent observability with zero per-job boilerplate.
5. **enqueueExternalApiRetry uses UUID jobId**: prevents BullMQ dedup from silently dropping a retry enqueue because an original enrollmentId-keyed job still exists in a completed/failed state.
6. **replayEvent() export from webhook.controller**: thin wrapper so webhookRetry.job.js calls the identical business logic path — no code duplication, single test surface.
7. **followupReminder is an explicit no-op**: logs a clear message instead of a TODO comment; the cron fires and records job_completed with { skipped: true } so observability dashboards show it as healthy.
8. **CRON_TIMEZONE env var**: UTC default prevents daily jobs from shifting with DST; operators in IST can set Asia/Kolkata without code changes.

### Scalability plan
- 6 jobs × N instances: only 1 instance per job tick executes work (Redis lock).
- Batch sizes bounded (50 rows per tick) to prevent a backlog from monopolising DB connections on recovery.
- Job errors are caught and logged; they never crash the process or suppress future ticks.

### Trade-offs
- followupReminder stub is the only deliberate placeholder; all other 5 jobs are fully operational.
- No new DB tables or migrations required for Phase 2B.
- No admin UI for job run history (Phase 2D).
- Batch limits mean a large backlog takes multiple ticks to drain — acceptable given the short tick intervals (2–5 min for the high-frequency jobs).

---

## T-2026-010 — Phase 2F: Granular RBAC + RS256 JWT
- iteration: 1
- date: 2026-05-06
- status: complete

### Modules created
- `src/modules/permissions/permission.repository.js` — findPermissionsByRole, findAllPermissions, upsertPermission, assignPermissionsToRole, clearRolePermissions
- `src/config/jwt.js` — signAccess, signRefresh, verifyAccess, verifyRefresh; HS256/RS256 mode via JWT_ALGORITHM env; lazy key-file loading

### Modules modified
- `src/prisma/schema.prisma` — added Permission + RolePermission models
- `src/config/constants.js` — added PERMISSIONS object (10 codes), PERMISSION_DENIED error code
- `src/config/env.js` — JWT_ALGORITHM + 4 RS256 key-path vars + cross-field Joi custom validation
- `src/middleware/rbac.middleware.js` — added hasPermission(code) factory + 60s in-process roleCache Map + clearPermissionCache(); authorize() preserved unchanged
- `src/middleware/auth.middleware.js` — jwt.verify replaced with verifyAccess() from jwt.js
- `src/modules/auth/auth.service.js` — signAccessToken/signRefreshToken replaced with signAccess/signRefresh from jwt.js
- `src/modules/payments/payment.repository.js` — added findPaymentById
- `src/modules/payments/payment.service.js` — added retryByPaymentId
- `src/modules/payments/payment.controller.js` — added retry handler
- `src/modules/payments/payment.routes.js` — added POST /:id/retry with hasPermission(PAYMENTS_RETRY)
- `src/prisma/seed.js` — added seedPermissions(); moved before seedSuperAdmin/seedRazorpayConfig
- All 7 protected route files — replaced authorize([...]) with hasPermission(...)
- `.env.example` — appended RS256 key section
- `README.md` — appended Phase 2F section

### Key architectural decisions
1. In-process Map cache for permissions (60 s TTL) — sufficient for role-level granularity with tiny data volume; no Redis needed here
2. Superadmin short-circuit in hasPermission — bypasses DB/cache entirely
3. RS256 opt-in via JWT_ALGORITHM=HS256 default — zero breaking change for existing HS256 callers
4. Key files loaded lazily once at first use, cached in module-scope closures
5. retryByPaymentId delegates to createOrder — all existing reuse/guard logic inherited
6. No permissions management API — role-level only, seed-managed

### Trade-offs
- Per-instance cache means permission changes propagate within 60 s (not instantly); acceptable for school management context
- RS256 requires manual key rotation procedure (documented in README)

---

## T-2026-009 — Phase 2E: Reports Module
- iteration: 1
- date: 2026-05-06
- status: complete

### Modules created
- `src/modules/reports/reports.repository.js` — getPaymentsSummary, getEnrollmentsFunnel, getExternalApiHealth (all via $queryRaw with Prisma.sql parameterised date filter), streamPaymentsForExport (async generator, cursor-paginated, BATCH=500)
- `src/modules/reports/reports.service.js` — getPaymentsSummary, getEnrollmentsFunnel, getExternalApiHealth (call repo + logger.info), streamCsv (csv-stringify streaming pipe to Express res; error handling splits pre-/post-header paths)
- `src/modules/reports/reports.validator.js` — dateRangeQuerySchema (reused by 3 summary routes), exportQuerySchema (type required, format defaults csv)
- `src/modules/reports/reports.controller.js` — 4 handlers: paymentsSummary, enrollmentsFunnel, externalApiHealth use sendSuccess; exportCsv delegates fully to service.streamCsv
- `src/modules/reports/reports.routes.js` — 4 GET routes, all behind authenticate + authorize(['admin','superadmin'])

### Files modified
- `package.json` — added csv-stringify ^6.5.0 (alphabetical position between cors and dotenv)
- `src/config/constants.js` — added UNSUPPORTED_REPORT_TYPE to ERROR_CODES
- `src/app.js` — imported reportsRoutes, mounted at /api/v1/reports
- `README.md` — Phase 2E section appended

### Key architectural decisions
1. $queryRaw + Prisma.sql template tags for aggregation queries — avoids N+1, pushes GROUP BY + COUNT to the DB engine.
2. buildDateFilter() returns Prisma.empty when no dates provided — safe interpolation into Prisma.sql without string concatenation.
3. All 7 EnrollmentStatus and 6 ExternalApiStatus values are hardcoded as constants in the repository so zero-count stages are always present in funnel/health responses (frontend graph stability).
4. streamPaymentsForExport uses cursor-based pagination (not offset) — safe for large tables with no drift as rows are inserted during export.
5. streamCsv splits error handling on res.headersSent — before headers: re-throw to centralized error handler for clean JSON error response; after headers: log + end stream (can't change status code once streaming).
6. csv-stringify streaming mode piped directly to res — zero in-memory accumulation regardless of table size.

### Trade-offs
- No PDF/XLSX export (master spec: CSV only)
- No new DB migration (read-only, queries existing tables)
- No audit log entries for reports (read-only endpoints; request logger already records them)
- total_amount_paise in payments-summary only sums 'success' payments — matches business intent for "settled revenue"; all statuses still visible in by_status breakdown

---

## T-2026-011 -- Phase 3B: Admin Frontend Adapter Endpoints
- iteration: 1
- date: 2026-05-06
- status: complete

### Modules created
- src/utils/transformAdmin.js -- mapPaymentStatus, mapEnrollmentStatus, mapExternalApiStatus, pickEnrollmentSummary helpers
- src/modules/admin/dashboard/dashboard.service.js -- getDashboardSummary (4 parallel Prisma queries)
- src/modules/admin/dashboard/dashboard.controller.js + dashboard.routes.js -- GET /api/v1/admin/dashboard
- src/modules/admin/adminEnrollments/adminEnrollment.validator.js + controller.js + routes.js -- GET /api/v1/admin/enrollments
- src/modules/admin/adminPayments/adminPayment.repository.js + validator.js + controller.js + routes.js -- GET /api/v1/admin/payments, GET /api/v1/admin/payments/failed
- src/modules/admin/adminFollowupsReport/adminFollowupsReport.validator.js + controller.js + routes.js -- GET /api/v1/admin/follow-ups/report

### Files modified
- src/modules/admin/externalApiLogs/externalApiLog.controller.js -- added camelCase transformer (toLogItem)
- src/app.js -- 4 new route mounts
- README.md -- Phase 3B section appended

### Key architectural decisions
1. transformAdmin.js is a pure utility with zero side-effects -- reused across all 4 new modules and the updated externalApiLogs controller
2. Dashboard uses Promise.all for 4 parallel Prisma queries (count x3 + aggregate x1) -- no sequential waterfall
3. Enrollment admin controller delegates entirely to existing enrollmentService.listEnrollments -- no duplicate query logic
4. adminPayment.repository uses $transaction([findMany, count]) matching the same pattern as enrollment.repository
5. payments/failed route declared before wildcard patterns in the router to avoid prefix shadowing
6. followup report reuses followup.repository.listFollowups directly -- no new repository
7. externalApiLog controller now returns flat { items, total, page, limit, totalPages } instead of raw rows array
8. All status fields normalised through transformAdmin mappers -- single source of truth for case mapping

### Trade-offs
- No new DB indexes needed -- all queries filter on status + created_at + deleted_at which are already indexed
- No migration -- read-only endpoints
- FollowUps admin page calls the public /follow-ups endpoint (followupService.list) directly; /admin/follow-ups/report is available but not yet linked to that page
