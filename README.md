# Kommon School — Multi-Tenant SaaS Backend API

Production-ready, horizontally-scalable Node.js/TypeScript backend for a school management SaaS platform. Supports unlimited school tenants, thousands of concurrent users, and full RBAC.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Load Balancer / Nginx                    │
└──────────────────────────┬──────────────────────────────────┘
                           │
           ┌───────────────┼───────────────┐
           ▼               ▼               ▼
     ┌──────────┐    ┌──────────┐    ┌──────────┐
     │ PM2 Node │    │ PM2 Node │    │ PM2 Node │   ← Cluster mode
     │ Worker 1 │    │ Worker 2 │    │ Worker N │
     └────┬─────┘    └────┬─────┘    └────┬─────┘
          │               │               │
          └───────────────┼───────────────┘
                          │
          ┌───────────────┼───────────────┐
          ▼                               ▼
   ┌─────────────┐                ┌─────────────┐
   │ PostgreSQL  │                │    Redis    │
   │  (Prisma)   │                │  (cache +   │
   │             │                │  rate-limit │
   └─────────────┘                │  + queues)  │
                                  └─────────────┘

Request flow:
  Client → Load Balancer
         → Express (requestId, tenant resolution, JWT auth, RBAC)
         → Route Handler → Service Layer → Prisma (DB) + Redis (cache)
         → Standardized JSON response
```

## Features

- **Multi-tenancy** — tenant resolved via `X-Tenant-Id` header or subdomain; all queries auto-scoped
- **RBAC** — `SUPER_ADMIN`, `SCHOOL_ADMIN`, `TEACHER`, `STUDENT`, `PARENT`
- **JWT** — short-lived access tokens (15m) + long-lived refresh tokens (7d) with rotation & reuse detection
- **Redis caching** — cache-aside with TTL jitter, graceful degradation on Redis failure
- **Rate limiting** — global (1000 req/15min) + auth (20 req/15min) + sensitive (5 req/hr), Redis-backed
- **Structured logging** — Pino JSON logs with requestId, userId, tenantId, latency
- **Swagger UI** — available at `/api/docs`
- **BullMQ** — email and report queues for background processing
- **Graceful shutdown** — drains HTTP, closes DB/Redis, stops workers on SIGTERM/SIGINT
- **Docker** — multi-stage build, non-root user, healthchecks
- **PM2** — cluster mode (one process per CPU core)

## Quick Start (local, no Docker)

```bash
# 1. Clone and install
npm install

# 2. Copy env file and configure
cp .env.example .env
# Edit .env: set DATABASE_URL, JWT secrets at minimum

# 3. Generate Prisma client
npm run prisma:generate

# 4. Run migrations (requires running Postgres)
npm run prisma:migrate

# 5. Seed demo data
npm run prisma:seed

# 6. Start dev server
npm run dev
```

## Quick Start (Docker Compose)

```bash
# Copy and edit env
cp .env.example .env
# At minimum set JWT_ACCESS_SECRET and JWT_REFRESH_SECRET

# Start all services (postgres, redis, app)
npm run docker:up

# Run migrations inside app container
docker-compose exec app npx prisma migrate deploy

# Seed demo data
docker-compose exec app node -e "require('./dist/prisma/seed')"

# View logs
npm run docker:logs
```

## Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `NODE_ENV` | `development` | Runtime environment |
| `PORT` | `3000` | HTTP server port |
| `DATABASE_URL` | — | PostgreSQL connection string (required) |
| `REDIS_HOST` | `localhost` | Redis hostname |
| `REDIS_PORT` | `6379` | Redis port |
| `JWT_ACCESS_SECRET` | — | HMAC secret for access tokens (min 32 chars, required) |
| `JWT_ACCESS_EXPIRY` | `15m` | Access token lifetime |
| `JWT_REFRESH_SECRET` | — | HMAC secret for refresh tokens (required) |
| `JWT_REFRESH_EXPIRY` | `7d` | Refresh token lifetime |
| `BCRYPT_SALT_ROUNDS` | `12` | bcrypt cost factor |
| `CORS_ORIGINS` | `http://localhost:3000` | Comma-separated allowed origins |
| `RATE_LIMIT_MAX_REQUESTS` | `1000` | Global rate limit per IP per window |
| `LOG_LEVEL` | `info` | Pino log level |
| `LOG_PRETTY` | `false` | Pretty-print logs (dev only) |
| `SWAGGER_ENABLED` | `true` | Mount Swagger UI at /api/docs |
| `TENANT_RESOLUTION_STRATEGY` | `header` | `header` or `subdomain` |
| `TENANT_HEADER_NAME` | `X-Tenant-Id` | Header name for tenant ID |
| `SHUTDOWN_TIMEOUT_MS` | `10000` | Graceful shutdown drain timeout |

Full list in `.env.example`.

## API Endpoints

Base URL: `http://localhost:3000/api/v1`

### Health
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | No | Liveness probe |
| GET | `/health/ready` | No | Readiness probe (DB + Redis checks) |
| GET | `/health/metrics` | No | Runtime metrics |

### Auth
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/register` | No | Register new user |
| POST | `/auth/login` | No | Login |
| POST | `/auth/refresh` | No | Refresh tokens |
| POST | `/auth/logout` | Yes | Logout (revoke token) |
| POST | `/auth/change-password` | Yes | Change password |
| GET | `/auth/me` | Yes | Current user profile |

### Users (school admin+)
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/users` | ADMIN+ | List users |
| GET | `/users/:id` | Yes | Get user |
| PATCH | `/users/:id` | Yes | Update user |
| DELETE | `/users/:id` | ADMIN+ | Soft-delete user |

### Tenants (super_admin only)
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/tenants` | SUPER_ADMIN | List tenants |
| GET | `/tenants/:id` | SUPER_ADMIN | Get tenant |
| POST | `/tenants` | SUPER_ADMIN | Create tenant |
| PATCH | `/tenants/:id` | SUPER_ADMIN | Update tenant |
| DELETE | `/tenants/:id` | SUPER_ADMIN | Soft-delete tenant |

### Students
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/students` | ADMIN/TEACHER | List students |
| GET | `/students/:id` | Yes | Get student |
| POST | `/students` | ADMIN | Create student |
| PATCH | `/students/:id` | ADMIN | Update student |
| DELETE | `/students/:id` | ADMIN | Soft-delete student |

### Enrollments (lead capture)
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/enrollments` | No (rate-limited) | Create enrollment — idempotent via `idempotencyKey` body field |
| GET | `/enrollments` | ADMIN/MARKETING/SCHOOL_ADMIN | Paginated list with filters (status, role, source, date range, search) |
| GET | `/enrollments/:id` | ADMIN/MARKETING/SCHOOL_ADMIN | Single enrollment with payment history and follow-up summary |

### Payments
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/payments/orders` | Yes | Create Razorpay order — idempotent, rate-limited |
| POST | `/payments/verify` | Yes | Verify client-side Razorpay payment signature |
| POST | `/payments/heartbeat` | Yes | Keep in-progress payment alive (prevents premature expiry) |
| POST | `/payments/refund` | ADMIN/SCHOOL_ADMIN | Initiate refund on Razorpay |
| GET | `/payments` | ADMIN/SCHOOL_ADMIN | Paginated list (filter by status, enrollment, tenant, date) |
| GET | `/payments/failed` | ADMIN/MARKETING/SCHOOL_ADMIN | List failed payments for CRM follow-up |
| GET | `/payments/:id` | Yes | Payment detail with audit log and ledger entries |

### Payment Webhook (top-level, non-versioned)
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/webhooks/razorpay` | HMAC signature | Razorpay webhook — raw body, signature-verified, idempotent |
| POST | `/api/v1/payments/webhook` | HMAC signature | Versioned alias for the same handler |

### CRM Follow-Ups
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/follow-ups/dashboard` | ADMIN/MARKETING/SCHOOL_ADMIN | CRM dashboard stats (counts by status, conversions) |
| POST | `/follow-ups` | ADMIN/MARKETING/SCHOOL_ADMIN | Manually create a follow-up (auto-created on enrollment) |
| GET | `/follow-ups` | ADMIN/MARKETING/SCHOOL_ADMIN | Paginated list (filter by status, priority, assignee, date) |
| GET | `/follow-ups/:id` | ADMIN/MARKETING/SCHOOL_ADMIN | Single follow-up with notes and interaction history |
| POST | `/follow-ups/:id/interactions` | ADMIN/MARKETING/SCHOOL_ADMIN | Log call / WhatsApp / email interaction |
| POST | `/follow-ups/:id/notes` | ADMIN/MARKETING/SCHOOL_ADMIN | Add internal note |
| PATCH | `/follow-ups/:id/status` | ADMIN/MARKETING/SCHOOL_ADMIN | Update status (with optional reassignment and reschedule) |

## Background Jobs and Cron

| Queue / Cron | Schedule / Trigger | Purpose |
|---|---|---|
| `email` queue | Event-driven (BullMQ) | Transactional email delivery (onboarding, payment receipts) |
| `report` queue | Event-driven (BullMQ) | Async report generation |
| `payment-reconciliation` queue | Triggered by webhook handler | Process Razorpay webhook events: state transitions, ledger writes, enrollment status updates |
| Payment expiry cron | Every 5 minutes (configurable) | Expire `INITIATED/CREATED/PENDING` payments past their TTL (`PAYMENT_TIMEOUT_MIN`) |
| Stale payment reconciliation | Every 15 minutes | Re-fetch Razorpay status for payments stuck in `IN_PROGRESS/PENDING` (fallback if webhook missed) |

## New Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `RAZORPAY_MODE` | `test` | `test` or `live` |
| `RAZORPAY_KEY_ID` | `` | Razorpay API key ID |
| `RAZORPAY_KEY_SECRET` | `` | Razorpay API key secret (never log) |
| `RAZORPAY_WEBHOOK_SECRET` | `` | HMAC secret for webhook signature verification |
| `CRON_ENABLED` | `true` | Toggle cron jobs (disable in CI / test) |
| `QUEUE_ENABLED` | `true` | Toggle BullMQ workers (disable in CI / test) |
| `PAYMENT_TIMEOUT_MIN` | `15` | Minutes before pending payments expire |
| `MAX_RETRY` | `3` | Max BullMQ retries for payment reconciliation jobs |
| `API_RETRY_LIMIT` | `5` | Max retries for outbound External API calls |
| `EXTERNAL_API_URL` | `` | Base URL of downstream ERP / data-sync API |
| `EXTERNAL_API_TOKEN` | `` | Bearer token for External API |
| `EXTERNAL_API_TIMEOUT_MS` | `10000` | Timeout for External API requests (ms) |

## Full Startup (local development)

```bash
# 1. Start PostgreSQL + Redis via Docker Compose
docker-compose up -d postgres redis

# 2. Install dependencies
npm install

# 3. Copy and configure env
cp .env.example .env
# Edit .env: set DATABASE_URL, JWT secrets, RAZORPAY_* values

# 4. Generate Prisma client
npm run prisma:generate

# 5. Run database migrations
npm run prisma:migrate

# 6. Seed demo data
npm run prisma:seed

# 7. Start dev server (hot-reload)
npm run dev
```

## Architecture Decisions

See [ARCHITECTURE_DECISIONS.md](./ARCHITECTURE_DECISIONS.md) for rationale on:
- Why PostgreSQL + Prisma instead of MongoDB + Mongoose
- Payment state machine design
- Idempotency key strategy
- Distributed locking approach
- Webhook flow and deduplication
- Double-entry ledger

## Request/Response Format

**Success:**
```json
{
  "success": true,
  "message": "Login successful",
  "data": { ... },
  "meta": { "page": 1, "limit": 20, "total": 100, "totalPages": 5 }
}
```

**Error:**
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": [{ "field": "email", "message": "Invalid email address" }]
  }
}
```

## Scaling

- **Horizontal**: Stateless API — run N instances behind a load balancer. All session state in Redis.
- **PM2 cluster**: `npm run start:cluster` — spawns one process per CPU core.
- **Docker Swarm / Kubernetes**: scale `app` service replicas; postgres and redis are single-node in compose but should be replaced with RDS/ElastiCache in production.
- **DB**: Prisma connection pool defaults to 10 connections per instance. Tune `DATABASE_POOL_SIZE`.
- **Redis**: Single node for development. Use Redis Sentinel or Cluster for production HA.

## Rotating Secrets

```bash
# Generate new JWT secrets
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# Update JWT_ACCESS_SECRET and JWT_REFRESH_SECRET in .env / secret manager
# All existing tokens will be immediately invalidated (users must re-login)
# Restart all app instances
```

## Swagger Docs

Available at: `http://localhost:3000/api/docs`
Raw spec: `http://localhost:3000/api/docs.json`

## Running Tests

```bash
npm test                # run all tests
npm run test:watch      # watch mode
npm run test:coverage   # with coverage report
```

## Seed Credentials (demo only)

| Role | Email | Password | Tenant |
|---|---|---|---|
| Super Admin | superadmin@kommon.school | SuperAdmin@123 | (none) |
| School Admin | admin@greenwood.edu | SchoolAdmin@123 | greenwood-high |
| Teacher | teacher@greenwood.edu | Teacher@123 | greenwood-high |
| Student | student@greenwood.edu | Student@123 | greenwood-high |
