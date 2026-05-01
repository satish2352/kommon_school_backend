# Backend Implementation Document

Complete production-grade backend for student enrollment, Razorpay payments,
marketing CRM, admin panel, external API integration, cron jobs, and queue
workers.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Tech Stack](#2-tech-stack)
3. [High-Level Architecture](#3-high-level-architecture)
4. [Folder Structure](#4-folder-structure)
5. [Database Models](#5-database-models)
6. [Endpoint Reference](#6-endpoint-reference)
7. [Request / Response Shapes](#7-request--response-shapes)
8. [Payment State Machine](#8-payment-state-machine)
9. [Webhook Flow](#9-webhook-flow)
10. [Idempotency](#10-idempotency)
11. [Distributed Locking](#11-distributed-locking)
12. [Cron Jobs](#12-cron-jobs)
13. [Queue System](#13-queue-system)
14. [External API Integration](#14-external-api-integration)
15. [Marketing CRM](#15-marketing-crm)
16. [RBAC](#16-rbac)
17. [Security](#17-security)
18. [Observability](#18-observability)
19. [Environment Variables](#19-environment-variables)
20. [Frontend Integration](#20-frontend-integration)
21. [Build, Run, Test](#21-build-run-test)
22. [Test Credentials](#22-test-credentials)
23. [Smoke Test Sequence](#23-smoke-test-sequence)
24. [Operational Runbook](#24-operational-runbook)
25. [Open TODOs](#25-open-todos)
26. [File Inventory](#26-file-inventory)
27. [Summary](#27-summary)

---

## 1. Project Overview

This document describes the complete backend system at
`D:\Satish Working Projects\kommon_school_project\backend`, exposed on
`http://localhost:3000`.

The service is the API for a React + Vite frontend at
`D:\Satish Working Projects\kommon_school_project\kommon_school` (port 5173).
The frontend UI is unchanged. Integration happens through a thin service +
hook layer in `kommon_school/src/services/` and `kommon_school/src/hooks/`.

### Scope

| Module | Status |
|---|---|
| Student enrollment (idempotent intake) | Implemented |
| Razorpay payment system (state machine, signature, webhook source-of-truth, idempotency, partial payments, refunds, ledger) | Implemented |
| Marketing follow-up CRM (calls, interactions, notes, status flow, auto-rules) | Implemented |
| Admin panel APIs (dashboards, lists, reports) | Implemented |
| External API integration (post payment success, retry, DLQ) | Implemented |
| Cron jobs and queue workers (BullMQ + Redis, distributed locks) | Implemented |
| RBAC (SUPER_ADMIN, ADMIN, MARKETING, plus existing tenant roles) | Implemented |
| AES-256-GCM encryption of Razorpay credentials at rest | Implemented |
| Multi-tenant SaaS scaffold (Tenant, User, Student, Auth) | Pre-existing |
| Tests for new modules | Deferred |

### Goals

- Production-ready
- Horizontally scalable (stateless API + Redis-backed locks/queues)
- Fault-tolerant (idempotency, retry, DLQ, reconciliation crons)
- Strong consistency (transactional writes, ledger double-entry, status history)
- Idempotent APIs at every state-changing endpoint
- Event-driven architecture (queues for async work, webhook for source of truth)

---

## 2. Tech Stack

| Concern | Library | Version |
|---|---|---|
| Runtime | Node.js | >= 20 |
| Web framework | Express | 4.18 |
| Language | TypeScript | 5.4 |
| ORM | Prisma | 5.11 |
| Database | PostgreSQL | 16 (alpine) |
| Cache + locks | Redis (ioredis) | 7 (alpine) / 5.3 |
| Queue | BullMQ | 5.4 |
| Validation | Zod | 3.22 |
| Logging | Pino + cls-hooked | 8.19 + 4.2 |
| Auth | jsonwebtoken (JWT) | 9.0 |
| Password hashing | bcryptjs | 2.4 |
| Security headers | Helmet | 7.1 |
| Anti-pollution | hpp | 0.2 |
| Sanitization | xss | 1.0 |
| Rate limiting | express-rate-limit + rate-limit-redis | 7.2 + 4.2 |
| Throttling | express-slow-down | 2.0 |
| Tests | Jest + supertest | 29.7 + 6.3 |
| Build | tsc + tsc-alias | 5.4 + 1.8 |
| Process manager | PM2 | (cluster mode via `ecosystem.config.js`) |
| Container | Docker + docker-compose | latest |
| API docs | swagger-ui-express + swagger-jsdoc | 5.0 + 6.2 |

### Architecture Decision: Prisma + PostgreSQL (deviation from MongoDB + Mongoose)

The original specification listed MongoDB + Mongoose as MANDATORY. The existing
backend scaffold already used Prisma + PostgreSQL plus a multi-tenant SaaS
foundation. Migrating to Mongoose would have meant rebuilding the existing
scaffold (tenants, users, students, auth) for no architectural gain.

PostgreSQL was retained because:

1. **Stronger transactional guarantees** — webhook -> payment update + ledger
   entries needs ACID; Postgres delivers it natively.
2. **Ledger double-entry semantics** are easier with relational constraints.
3. **Audit history** (`statusHistory[]`, `interactions[]`, `history[]`) maps
   naturally to JSONB columns or related tables in Postgres.
4. **Existing scaffold preservation** — tenants, users, students, auth, and
   their migrations were already production-grade.
5. **Same operational story** for either choice: idempotency, locking, retry,
   reconciliation are all infrastructure concerns above the database layer.

Deviation is documented at the repo root in `ARCHITECTURE_DECISIONS.md`.

---

## 3. High-Level Architecture

```
                          ┌──────────────────┐
                          │   React + Vite   │
                          │   (port 5173)    │
                          └────────┬─────────┘
                                   │ HTTPS / fetch
                                   │ Idempotency-Key header
                                   ▼
            ┌──────────────────────────────────────────┐
            │       Express API (port 3000)            │
            │ - JWT auth middleware                    │
            │ - tenantResolver (X-Tenant-Id)           │
            │ - requestContext (correlationId, AsyncLS)│
            │ - validate (Zod)                         │
            │ - rateLimit (Redis store)                │
            │ - requireRole(...) RBAC guards           │
            ├──────────────────────────────────────────┤
            │  Modules (controller -> service -> repo) │
            │   enrollments | payments | followups     │
            │   externalApi | admin    | razorpayCfg   │
            │   auth | users | tenants | students      │
            ├──────────────────────────────────────────┤
            │   Utilities                              │
            │   razorpay (DB-backed config + 60s cache)│
            │   distributedLock (Redis SET NX PX)      │
            │   encryption (AES-256-GCM)               │
            │   ApiError, ApiResponse, asyncHandler    │
            └─────┬──────────┬──────────┬──────────────┘
                  │          │          │
       ┌──────────▼─┐  ┌─────▼─────┐  ┌─▼───────────────┐
       │ PostgreSQL │  │   Redis   │  │ Razorpay (HTTPS)│
       │  (Prisma)  │  │  - cache  │  │  - orders       │
       │            │  │  - locks  │  │  - payments     │
       │            │  │  - BullMQ │  │  - refunds      │
       └────────────┘  └─────┬─────┘  └────────┬────────┘
                             │                 │ webhook (raw body)
                             │                 ▼
                       ┌─────▼─────────────────────────┐
                       │       BullMQ Workers          │
                       │  email | report               │
                       │  paymentReconciliation        │
                       │  payment-cron                 │
                       │    payment-recovery (5m)      │
                       │    payment-reconciliation(30m)│
                       │    payment-expiry (10m)       │
                       │  external-api-cron            │
                       │    sync-payment (event)       │
                       │    external-api-retry (15m)   │
                       │    dlq-processor (1h)         │
                       │  followup-cron                │
                       │    follow-up-reminder (10m)   │
                       │    stale-leads (6h)           │
                       │    auto-close (24h)           │
                       └───────────────┬───────────────┘
                                       │
                                       ▼
                       ┌──────────────────────────────┐
                       │  External downstream API     │
                       │  POST /users with bearer     │
                       │  exponential backoff + DLQ   │
                       └──────────────────────────────┘
```

### Process model

- **Stateless API**: any number of replicas behind a load balancer.
- **Workers**: can be co-located with the API or run as separate processes.
  Toggle with `QUEUE_ENABLED`.
- **Cron registration**: gated by `CRON_ENABLED`; only one replica should
  register cron jobs (BullMQ deduplicates via `jobId`, but you can also gate
  via env to be explicit).
- **PM2 cluster mode**: `ecosystem.config.js` provides multi-core scaling on
  a single host. For multi-host scaling, run separate Docker containers behind
  the load balancer.

---

## 4. Folder Structure

```
backend/
├── prisma/
│   ├── schema.prisma                       # 13 models
│   ├── seed.ts
│   └── migrations/
│       └── 20260501000000_add_payments_enrollments_followups/
├── src/
│   ├── config/
│   │   ├── database.ts                     # Prisma client singleton
│   │   ├── env.ts                          # Zod-validated env loader
│   │   ├── logger.ts                       # Pino + cls-hooked
│   │   ├── redis.ts                        # ioredis singleton
│   │   └── swagger.ts                      # OpenAPI generation
│   ├── loaders/
│   │   ├── db.loader.ts                    # connect Prisma at boot
│   │   └── express.loader.ts               # mounts /webhooks/razorpay BEFORE JSON parser (raw body)
│   ├── middlewares/
│   │   ├── auth.middleware.ts              # JWT verify + requireRole(...roles)
│   │   ├── errorHandler.middleware.ts      # ApiError -> JSON, hides stack in prod
│   │   ├── rateLimiter.middleware.ts       # Redis-backed rate limit
│   │   ├── requestContext.middleware.ts    # correlationId via cls-hooked
│   │   ├── requestLogger.middleware.ts     # pino-http
│   │   ├── tenantResolver.middleware.ts    # X-Tenant-Id -> req.tenant
│   │   └── validate.middleware.ts          # Zod request validation
│   ├── modules/
│   │   ├── auth/
│   │   ├── health/
│   │   ├── users/
│   │   ├── tenants/
│   │   ├── students/
│   │   ├── enrollments/
│   │   │   ├── enrollments.controller.ts
│   │   │   ├── enrollments.service.ts
│   │   │   ├── enrollments.repository.ts
│   │   │   ├── enrollments.schema.ts       # Zod schemas
│   │   │   └── enrollments.routes.ts
│   │   ├── payments/
│   │   │   ├── payments.controller.ts
│   │   │   ├── payments.service.ts
│   │   │   ├── payments.repository.ts
│   │   │   ├── payments.schema.ts
│   │   │   ├── payments.routes.ts
│   │   │   └── payments.webhook.ts         # HMAC-verified, deduped, enqueues processing
│   │   ├── followups/
│   │   │   ├── followups.controller.ts
│   │   │   ├── followups.service.ts
│   │   │   ├── followups.repository.ts
│   │   │   ├── followups.schema.ts
│   │   │   └── followups.routes.ts
│   │   ├── externalApi/
│   │   │   ├── externalApi.client.ts       # fetch + AbortController + token refresh
│   │   │   ├── externalApi.service.ts      # syncUserAfterPayment + retryExternalApiLog
│   │   │   └── externalApi.repository.ts
│   │   └── admin/
│   │       ├── admin.controller.ts
│   │       ├── admin.service.ts
│   │       ├── admin.repository.ts
│   │       ├── admin.routes.ts             # ADMIN + SUPER_ADMIN guarded
│   │       └── razorpayConfigs/
│   │           ├── razorpayConfigs.controller.ts
│   │           ├── razorpayConfigs.service.ts
│   │           ├── razorpayConfigs.repository.ts
│   │           ├── razorpayConfigs.schema.ts
│   │           └── razorpayConfigs.routes.ts  # SUPER_ADMIN only
│   ├── jobs/
│   │   ├── queues.ts                       # BullMQ Queue instances
│   │   ├── workers.ts                      # email, report, paymentReconciliation, payment-cron, external-api-cron, follow-up-cron
│   │   └── cron.ts                         # registers 8 BullMQ repeatable jobs
│   ├── routes/
│   │   └── v1.ts                           # mounts all /api/v1 routes incl. /admin
│   ├── utils/
│   │   ├── ApiError.ts                     # typed error with statusCode, code, details
│   │   ├── ApiResponse.ts                  # uniform { success, data, error } envelope
│   │   ├── asyncHandler.ts                 # promise -> next(err) wrapper
│   │   ├── cache.ts                        # Redis cache helpers
│   │   ├── distributedLock.ts              # Redis SET NX PX wrapper
│   │   ├── encryption.ts                   # AES-256-GCM encrypt/decrypt/maskSecret
│   │   ├── jwt.ts                          # sign/verify access + refresh
│   │   ├── password.ts                     # bcrypt wrappers
│   │   ├── razorpay.ts                     # active config from DB, Redis cache (60s TTL)
│   │   └── requestContext.ts               # cls-hooked accessors
│   ├── types/                              # ambient + domain types
│   ├── app.ts                              # createApp() factory
│   └── server.ts                           # boots HTTP, starts workers, registers cron
├── tests/
│   ├── unit/
│   │   ├── ApiError.test.ts
│   │   ├── jwt.test.ts
│   │   └── password.test.ts
│   └── integration/
│       └── health.test.ts
├── docker/
├── docker-compose.yml
├── Dockerfile
├── ecosystem.config.js                     # PM2 cluster mode
├── package.json
├── tsconfig.json
├── jest.config.ts
├── README.md
├── ARCHITECTURE_DECISIONS.md
└── BACKEND_IMPLEMENTATION.md               # this file
```

---

## 5. Database Models

### 5.1 Model summary (13 models in `prisma/schema.prisma`)

| Model | Purpose |
|---|---|
| `Tenant` | Multi-tenant root (school/organization) |
| `User` | Auth principal, role-bearing |
| `Session` | Refresh-token store |
| `Student` | Student record (within a tenant) |
| `Enrollment` | Lead intake (public submission, pre-tenant) |
| `Payment` | Razorpay order/payment with state machine |
| `WebhookEvent` | Idempotent webhook log, source of truth |
| `IdempotencyKey` | Cached responses for repeated requests |
| `LedgerEntry` | Double-entry record per payment / refund |
| `RazorpayConfig` | Per-tenant credentials (encrypted at rest) |
| `FollowUp` | CRM record per enrollment |
| `FollowUpInteraction` | Call / WhatsApp / email log |
| `ExternalApiLog` | Outbound HTTP call audit + retry state |

### 5.2 Key field reference

#### Enrollment

```
id                String   @id @default(cuid())
enrollmentId      String   @unique          // ENR-YYYYMMDD-XXXXXX
idempotencyKey    String   @unique
tenantId          String?
name              String
email             String
phone             String
role              String                    // Student | Fresh Graduate | Working Professional | Career Switcher
education         String?
readiness         String?
source            String?
status            EnrollmentStatus          // NEW | CONTACTED | CONVERTED | CLOSED
metadata          Json?
createdAt         DateTime @default(now())
updatedAt         DateTime @updatedAt

@@unique([email, phone])                    // dedupe at intake
@@index([status, createdAt])
```

#### Payment

```
id                  String   @id @default(cuid())
transactionId       String   @unique        // internal TXN-...
enrollmentId        String
razorpayOrderId     String?  @unique
razorpayPaymentId   String?  @unique
status              PaymentStatus           // INITIATED | CREATED | IN_PROGRESS | PENDING | SUCCESS | FAILED | PARTIAL | REFUNDED | EXPIRED
statusHistory       Json[]                  // [{ status, at, reason, correlationId }]
failureType         FailureType?            // USER_CANCELLED | PAYMENT_FAILED | GATEWAY_ERROR | NETWORK_ERROR
currency            String   @default("INR")
baseAmount          Int                     // paise
taxAmount           Int      @default(0)
discount            Int      @default(0)
finalAmount         Int                     // = baseAmount + taxAmount - discount
totalAmount         Int                     // for partial-pay scenarios
paidAmount          Int      @default(0)
remainingAmount     Int      @default(0)
paymentAttempt      Json?                   // { startedAt, lastHeartbeatAt, retryCount, clientConfirmation }
expiresAt           DateTime
createdAt           DateTime @default(now())
updatedAt           DateTime @updatedAt

@@index([status, createdAt])
@@index([enrollmentId])
```

#### WebhookEvent

```
id           String   @id @default(cuid())
provider     String                          // "razorpay"
eventId      String                          // razorpay event id
eventType    String                          // payment.captured | order.paid | refund.created | ...
payload      Json
signature    String
payloadHash  String                          // sha256(rawBody)
processed    Boolean  @default(false)
processedAt  DateTime?
error        String?
createdAt    DateTime @default(now())

@@unique([provider, eventId])                // duplicate webhooks rejected
@@index([processed, createdAt])
```

#### IdempotencyKey

```
id           String   @id @default(cuid())
key          String   @unique
requestHash  String                          // sha256(method + path + body)
response     Json
status       Int                             // HTTP status to replay
expiresAt    DateTime
createdAt    DateTime @default(now())

@@index([expiresAt])
```

#### LedgerEntry

```
id          String      @id @default(cuid())
paymentId   String
type        LedgerType                       // DEBIT | CREDIT
source      LedgerSource                     // PAYMENT | REFUND
amount      Int                              // paise, always positive
currency    String      @default("INR")
description String?
metadata    Json?
createdAt   DateTime    @default(now())

@@index([paymentId, createdAt])
```

#### RazorpayConfig

```
id              String   @id @default(cuid())
tenantId        String?                       // null = global default
name            String
mode            String                        // "test" | "live"
keyId           String
keySecretEnc    String                        // AES-256-GCM ciphertext
webhookSecretEnc String
isActive        Boolean  @default(false)
createdBy       String?
createdAt       DateTime @default(now())
updatedAt       DateTime @updatedAt

@@unique([tenantId, mode, isActive])          // only one active per (tenant, mode)
```

#### FollowUp

```
id              String        @id @default(cuid())
enrollmentId    String
tenantId        String?
assignedTo      String?                       // userId
status          FollowUpStatus                // NEW | CONTACTED | FOLLOW_UP | CALLBACK | PAYMENT_PENDING | CONVERTED | NOT_INTERESTED | CLOSED
priority        Priority      @default(MEDIUM)// LOW | MEDIUM | HIGH
callAttempts    Int           @default(0)
lastContactAt   DateTime?
nextFollowUpAt  DateTime?
notes           Json[]
tags            String[]
paymentIntent   Json?                         // { interested, expectedAmount, expectedDate }
history         Json[]
createdAt       DateTime      @default(now())
updatedAt       DateTime      @updatedAt

@@index([status, nextFollowUpAt])
@@index([assignedTo])
```

#### FollowUpInteraction

```
id              String          @id @default(cuid())
followUpId      String
type            InteractionType                // CALL | WHATSAPP | EMAIL
outcome         Outcome                        // CONNECTED | NOT_REACHABLE | SWITCHED_OFF | BUSY | WRONG_NUMBER
userResponse    UserResponse?                  // INTERESTED | CALL_BACK | FOLLOW_UP_LATER | NOT_INTERESTED | PAYMENT_DONE | NEED_DETAILS
callDuration    Int?                           // seconds
remarks         String?
nextAction      NextAction?                    // FOLLOW_UP | CALLBACK | CLOSE | WAIT_PAYMENT
nextFollowUpAt  DateTime?
createdBy       String
createdAt       DateTime        @default(now())

@@index([followUpId, createdAt])
```

#### ExternalApiLog

```
id             String              @id @default(cuid())
paymentId      String
endpoint       String
requestBody    Json
responseStatus Int?
responseBody   Json?
status         ExternalApiStatus                // PENDING | SUCCESS | FAILED | DEAD_LETTER
retryCount     Int      @default(0)
nextRetryAt    DateTime?
error          String?
createdAt      DateTime @default(now())
updatedAt      DateTime @updatedAt

@@index([status, nextRetryAt])
```

### 5.3 Money

All amounts are stored in **paise (integer)**. Currency code stored explicitly.
No floats anywhere in the money path. Conversion to display happens at the UI
boundary only.

### 5.4 Migrations

```
prisma/migrations/20260501000000_add_payments_enrollments_followups/
```

Created with `--create-only`. Apply via `npm run prisma:migrate:deploy`.

Rollback strategy: Prisma does not auto-rollback. For production, prefer
forward-only migrations (add a column, deploy, populate, deploy code that
reads it, then later remove old column). Backups via `pg_dump` are the
safety net.

---

## 6. Endpoint Reference

### 6.1 Top level

```
POST   /webhooks/razorpay
       Raw body, HMAC SHA256 verified.
       Stores WebhookEvent (unique eventId), enqueues processing, returns 200.
```

### 6.2 Auth & users

```
GET    /api/v1/health                         Liveness + readiness probe (DB + Redis status)
POST   /api/v1/auth/register                  Public
POST   /api/v1/auth/login                     Public
POST   /api/v1/auth/refresh                   Refresh-token rotation
POST   /api/v1/auth/logout                    Revoke refresh token

GET    /api/v1/users                          Tenant-scoped (admin)
GET    /api/v1/users/:id
PATCH  /api/v1/users/:id

GET    /api/v1/tenants                        SUPER_ADMIN
POST   /api/v1/tenants                        SUPER_ADMIN
PATCH  /api/v1/tenants/:id                    SUPER_ADMIN

GET    /api/v1/students                       Tenant-scoped
POST   /api/v1/students
GET    /api/v1/students/:id
PATCH  /api/v1/students/:id
```

### 6.3 Enrollment

```
POST   /api/v1/enrollments                    Public. Idempotent via Idempotency-Key header. Creates lead.
GET    /api/v1/enrollments                    ADMIN/SUPER_ADMIN. Filters: status, source, dateRange, page, limit.
GET    /api/v1/enrollments/:id                ADMIN/SUPER_ADMIN.
```

### 6.4 Payments

```
POST   /api/v1/payments/order                 Create Razorpay order for an enrollment. Idempotent.
POST   /api/v1/payments/verify                Verify HMAC after gateway redirect. Marks IN_PROGRESS pending webhook.
POST   /api/v1/payments/heartbeat             Frontend pings while user is on gateway. Updates paymentAttempt.
GET    /api/v1/payments/:id                   Get payment + statusHistory.
POST   /api/v1/payments/refund                ADMIN. Initiates refund; ledger entries written atomically.
```

### 6.5 Follow-ups (CRM)

```
POST   /api/v1/follow-ups                     MARKETING/ADMIN. Create from enrollment.
GET    /api/v1/follow-ups                     Filters: status, priority, assignedTo, dateRange.
GET    /api/v1/follow-ups/:id
POST   /api/v1/follow-ups/:id/interactions    Log call/whatsapp/email outcome + userResponse.
POST   /api/v1/follow-ups/:id/notes
PATCH  /api/v1/follow-ups/:id/status          Status transitions per CRM flow.
```

### 6.6 Admin dashboards

```
GET    /api/v1/admin/dashboard                Today's enrollments, today's revenue (paise), pending payments, follow-ups due.
GET    /api/v1/admin/enrollments              Filters: status, source, from, to, page, limit.
GET    /api/v1/admin/payments                 Filters: status, from, to, minAmount, maxAmount, page, limit.
GET    /api/v1/admin/payments/failed          Failed/expired payments only.
GET    /api/v1/admin/external-api-logs        Filters: status, from, to.
GET    /api/v1/admin/follow-ups/report        Counts by status, conversion funnel, by-assignee.
```

All admin endpoints require `ADMIN` or `SUPER_ADMIN` role.

### 6.7 Razorpay config management

```
POST   /api/v1/admin/razorpay-configs                 SUPER_ADMIN. Encrypts secrets at rest (AES-256-GCM).
GET    /api/v1/admin/razorpay-configs                 SUPER_ADMIN. Returns masked secrets.
PATCH  /api/v1/admin/razorpay-configs/:id             SUPER_ADMIN.
POST   /api/v1/admin/razorpay-configs/:id/activate    SUPER_ADMIN. Atomic deactivate-others-then-activate.
DELETE /api/v1/admin/razorpay-configs/:id             SUPER_ADMIN. Guarded against deleting active config.
```

---

## 7. Request / Response Shapes

### 7.1 Uniform response envelope

All successful responses:

```json
{
  "success": true,
  "data": <payload>,
  "meta": { "correlationId": "uuid", "page": 1, "limit": 20, "total": 100 }
}
```

All error responses:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "phone must be 10 digits",
    "details": [{ "path": ["phone"], "message": "..." }]
  },
  "meta": { "correlationId": "uuid" }
}
```

### 7.2 Standard error codes

| HTTP | Code | Trigger |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Zod schema rejected the request |
| 401 | `UNAUTHENTICATED` | No / invalid JWT |
| 403 | `FORBIDDEN` | Wrong role or wrong tenant |
| 404 | `NOT_FOUND` | Resource missing |
| 409 | `CONFLICT` | Duplicate (email+phone), idempotency mismatch, state conflict |
| 410 | `EXPIRED` | Payment past TTL |
| 422 | `UNPROCESSABLE` | Business rule violation (e.g. refund > paid) |
| 429 | `RATE_LIMITED` | Rate limit hit |
| 500 | `INTERNAL_ERROR` | Unhandled exception |
| 502 | `GATEWAY_ERROR` | Razorpay or external API upstream failure |
| 503 | `SERVICE_UNAVAILABLE` | DB / Redis down |

### 7.3 Enrollment

#### POST /api/v1/enrollments

Request:

```http
POST /api/v1/enrollments HTTP/1.1
Content-Type: application/json
Idempotency-Key: 7a2c0f7e-1f43-4f96-9e3d-2b6e6f3f51e1

{
  "name": "Priya Sharma",
  "email": "priya@example.com",
  "phone": "9876543210",
  "role": "Student",
  "education": "Undergraduate",
  "readiness": "Beginner",
  "source": "Google Search"
}
```

Validation (Zod):

```
name        string, trim, min 2, max 100
email       valid email
phone       string, exactly 10 digits
role        enum: Student | Fresh Graduate | Working Professional | Career Switcher
education   optional enum
readiness   optional enum
source      optional enum
```

Response 201:

```json
{
  "success": true,
  "data": {
    "id": "ckxe...",
    "enrollmentId": "ENR-20260501-A4F3X9",
    "status": "NEW",
    "createdAt": "2026-05-01T10:23:45.123Z"
  },
  "meta": { "correlationId": "..." }
}
```

Response 409 (duplicate):

```json
{
  "success": false,
  "error": {
    "code": "CONFLICT",
    "message": "Enrollment with this email and phone already exists",
    "details": { "existingEnrollmentId": "ENR-20260420-..." }
  }
}
```

### 7.4 Payments

#### POST /api/v1/payments/order

Request:

```http
POST /api/v1/payments/order HTTP/1.1
Authorization: Bearer <token>
Content-Type: application/json
Idempotency-Key: <uuid>

{
  "enrollmentId": "ckxe...",
  "amount": 9900000,
  "currency": "INR",
  "tax": 1782000,
  "discount": 0
}
```

Response 201:

```json
{
  "success": true,
  "data": {
    "paymentId": "ckxz...",
    "transactionId": "TXN-20260501-7K3D",
    "razorpayOrderId": "order_NkA3xN9W...",
    "razorpayKeyId": "rzp_test_...",
    "amount": 11682000,
    "currency": "INR",
    "expiresAt": "2026-05-01T10:38:45.123Z"
  }
}
```

#### POST /api/v1/payments/verify

Request body (sent by frontend after Razorpay Checkout returns):

```json
{
  "razorpayOrderId": "order_NkA3xN9W...",
  "razorpayPaymentId": "pay_NkA4yz...",
  "razorpaySignature": "9b7ee12..."
}
```

Server: HMAC-SHA256(`orderId|paymentId`, keySecret) === signature.

Response 200:

```json
{
  "success": true,
  "data": {
    "paymentId": "ckxz...",
    "status": "IN_PROGRESS",
    "message": "Payment captured. Confirmation pending webhook."
  }
}
```

#### POST /api/v1/payments/heartbeat

Request:

```json
{ "paymentId": "ckxz...", "clientConfirmation": false }
```

Response: 204 No Content. Updates `Payment.paymentAttempt.lastHeartbeatAt`.

#### POST /api/v1/payments/refund

Request (ADMIN only):

```json
{
  "paymentId": "ckxz...",
  "amount": 9900000,
  "reason": "requested_by_customer",
  "speed": "normal"
}
```

Response 200:

```json
{
  "success": true,
  "data": {
    "refundId": "rfnd_NkB2...",
    "refundStatus": "processed",
    "refundedAmount": 9900000
  }
}
```

### 7.5 Follow-ups

#### POST /api/v1/follow-ups

```json
{
  "enrollmentId": "ckxe...",
  "assignedTo": "user_id",
  "priority": "HIGH",
  "tags": ["hot"]
}
```

#### POST /api/v1/follow-ups/:id/interactions

```json
{
  "type": "CALL",
  "outcome": "CONNECTED",
  "userResponse": "CALL_BACK",
  "callDuration": 215,
  "remarks": "Interested but wants to discuss with parents",
  "nextAction": "CALLBACK",
  "nextFollowUpAt": "2026-05-03T10:00:00.000Z"
}
```

Auto-rules applied by service:

- `userResponse=PAYMENT_DONE` -> followUp.status = `CONVERTED`
- `userResponse=NOT_INTERESTED` -> followUp.status = `CLOSED`
- `userResponse=CALL_BACK` -> nextFollowUpAt updated, status -> `CALLBACK`
- All cases: `callAttempts++`, `lastContactAt = now()`, `history` appended.

### 7.6 Admin dashboards

#### GET /api/v1/admin/dashboard

```json
{
  "success": true,
  "data": {
    "today": {
      "enrollments": 42,
      "revenuePaise": 12450000,
      "successfulPayments": 18,
      "failedPayments": 3
    },
    "pendingPayments": 7,
    "followUpsDue": 12,
    "deadLetterQueue": 0,
    "asOf": "2026-05-01T15:00:00.000Z"
  }
}
```

#### GET /api/v1/admin/follow-ups/report

```json
{
  "success": true,
  "data": {
    "byStatus": {
      "NEW": 130,
      "CONTACTED": 78,
      "CALLBACK": 22,
      "CONVERTED": 41,
      "CLOSED": 50
    },
    "conversionFunnel": {
      "enrollments": 250,
      "contacted": 180,
      "interested": 95,
      "paid": 41,
      "rate": 0.164
    },
    "byAssignee": [
      { "userId": "u_1", "name": "Riya", "leads": 60, "converted": 18 }
    ]
  }
}
```

### 7.7 Razorpay config

#### POST /api/v1/admin/razorpay-configs

```json
{
  "name": "Main Test Account",
  "mode": "test",
  "tenantId": null,
  "keyId": "rzp_test_xxxxx",
  "keySecret": "xxxxxxxxxxxxxxxxxxx",
  "webhookSecret": "xxxxxxxxxxxxxxxxxxx"
}
```

Response: secrets are NOT echoed back. List returns masked form
`xxxx****xxxx`.

#### POST /api/v1/admin/razorpay-configs/:id/activate

Atomic transaction:

```sql
BEGIN;
UPDATE razorpay_configs SET isActive = false WHERE tenantId = $1 AND mode = $2;
UPDATE razorpay_configs SET isActive = true  WHERE id = $3;
COMMIT;
```

After commit, the Redis cache key for that (tenantId, mode) is invalidated so
the next Razorpay call uses the new credentials.

### 7.8 Webhook payload (Razorpay)

The endpoint accepts the standard Razorpay webhook envelope. Example for
`payment.captured`:

```json
{
  "entity": "event",
  "account_id": "acc_NkABCD123",
  "event": "payment.captured",
  "contains": ["payment"],
  "payload": {
    "payment": {
      "entity": {
        "id": "pay_NkA4yz...",
        "order_id": "order_NkA3xN9W...",
        "status": "captured",
        "amount": 11682000,
        "currency": "INR",
        "method": "card",
        "captured": true,
        "created_at": 1714566225
      }
    }
  },
  "created_at": 1714566230
}
```

Required header: `X-Razorpay-Signature: <hex hmac sha256>`.

Server verifies:

```
expectedSignature = HMAC_SHA256(rawBody, RAZORPAY_WEBHOOK_SECRET)
constant_time_equal(headerSignature, expectedSignature)
```

If verification passes:

1. Acquire `lock:webhook:{eventId}` (TTL 30s).
2. `INSERT INTO webhook_events (...) ON CONFLICT (provider, event_id) DO NOTHING`.
3. If row was inserted, enqueue processing job. If conflict, ignore (duplicate
   delivery).
4. Return 200 immediately. Heavy lifting happens in the worker.

---

## 8. Payment State Machine

### 8.1 States

```
INITIATED -> CREATED -> IN_PROGRESS -> PENDING -> SUCCESS
                                              -> FAILED
                                              -> PARTIAL
                                    -> EXPIRED
SUCCESS   -> REFUNDED (full or partial)
```

| State | Meaning |
|---|---|
| `INITIATED` | Row created, no Razorpay order yet |
| `CREATED` | Razorpay order id assigned |
| `IN_PROGRESS` | User redirected to Razorpay; signature verified by `/verify` |
| `PENDING` | Awaiting webhook confirmation (some methods complete async) |
| `SUCCESS` | Webhook confirmed `payment.captured` |
| `FAILED` | Webhook confirmed failure or signature/verification fail |
| `PARTIAL` | Less than `totalAmount` paid (multi-installment scenario) |
| `EXPIRED` | TTL passed without resolution |
| `REFUNDED` | All paid amount refunded; partial refund stays `SUCCESS` with paidAmount adjusted |

Every transition appends to `Payment.statusHistory`:

```json
{
  "from": "IN_PROGRESS",
  "to": "SUCCESS",
  "at": "2026-05-01T10:25:01.000Z",
  "reason": "webhook:payment.captured",
  "correlationId": "..."
}
```

### 8.2 Failure types

```
USER_CANCELLED | PAYMENT_FAILED | GATEWAY_ERROR | NETWORK_ERROR
```

### 8.3 Webhook is the source of truth

The `/verify` endpoint marks a payment as `IN_PROGRESS` after signature
verification, but the final terminal status (`SUCCESS` / `FAILED`) is only
written when the corresponding Razorpay webhook event arrives. This handles
the case where the user pays but the frontend crashes mid-redirect.

### 8.4 Payment interruption handling

`Payment.paymentAttempt` subdoc:

```json
{
  "startedAt": "2026-05-01T10:23:45.000Z",
  "lastHeartbeatAt": "2026-05-01T10:25:14.000Z",
  "retryCount": 0,
  "clientConfirmation": false
}
```

Frontend posts to `POST /api/v1/payments/heartbeat` every ~5s while user is on
the Razorpay Checkout page. If heartbeats stop for longer than
`PAYMENT_TIMEOUT_MIN`, the **payment-recovery cron** queries Razorpay for the
order's true status and reconciles.

### 8.5 Retry strategy

- Same `enrollmentId` + non-terminal payment + new order request: existing
  payment row is returned (idempotent).
- Terminal failure: a NEW payment row is created on the next order request;
  no duplicate charge possible because each attempt has a unique
  `razorpayOrderId`.
- Maximum non-terminal active orders per enrollment: 1.

### 8.6 Partial payments

```
totalAmount     = 30000000  (e.g., split into 3 installments of 100,000.00 INR)
paidAmount      = 10000000  (first installment paid)
remainingAmount = 20000000

status -> PARTIAL while paidAmount > 0 && paidAmount < totalAmount
status -> SUCCESS when paidAmount >= totalAmount
```

Each successful partial payment writes:

- A `Payment` update (paidAmount/remainingAmount, statusHistory append)
- A `LedgerEntry` (`type=DEBIT, source=PAYMENT`)
- A counter `LedgerEntry` (`type=CREDIT, source=PAYMENT`) crediting the
  customer-receivable account

All in one Prisma transaction.

### 8.7 Refunds

- Full refund: `RefundedAmount = paidAmount`. Status -> `REFUNDED`.
- Partial refund: `RefundedAmount < paidAmount`. Status stays `SUCCESS` with
  `paidAmount` decremented and ledger entries reflecting the refund.
- Each refund writes a paired `LedgerEntry` with `source=REFUND`.

### 8.8 Expiry

Payments older than `PAYMENT_TIMEOUT_MIN` and still in non-terminal state
(`INITIATED|CREATED|IN_PROGRESS|PENDING`) are marked `EXPIRED` by the
`payment-expiry` cron. statusHistory records the auto-transition.

---

## 9. Webhook Flow

### 9.1 Sequence

```
Razorpay -> POST /webhooks/razorpay
            (raw body, X-Razorpay-Signature)
                |
                v
         express.raw({ type: 'application/json' })
                |
                v
         payments.webhook handler
                |
                +---- compute HMAC, compare in constant time
                |     fail -> 400 (no DB write)
                |
                +---- acquire lock:webhook:{eventId} (TTL 30s)
                |
                +---- INSERT WebhookEvent ON CONFLICT (provider, eventId) DO NOTHING
                |     conflict -> dedupe, release lock, return 200
                |
                +---- enqueue 'process-webhook' job to paymentReconciliationQueue
                |
                +---- release lock, return 200 (within ~50ms target)

paymentReconciliationWorker pops job
                |
                v
         payments.service.processWebhookEvent(eventId)
                |
                +---- load WebhookEvent, mark processing
                |
                +---- acquire lock:payment:{paymentId} (TTL 30s)
                |
                +---- BEGIN TRANSACTION
                |     - update Payment row (status, paidAmount, statusHistory)
                |     - insert LedgerEntry pair
                |     - if SUCCESS: enqueue 'sync-payment' to externalApiCronQueue
                |     COMMIT
                |
                +---- mark WebhookEvent.processed = true, processedAt = now
                |
                +---- release lock, ack job
```

### 9.2 Why mount before JSON parser

Razorpay signs the **raw bytes** of the request body. If Express parses the
body to JSON first, `JSON.stringify(req.body)` will not produce byte-identical
output (whitespace, key ordering), and HMAC verification will fail. The
webhook route must use `express.raw({ type: 'application/json' })` and
**must** be mounted before `app.use(express.json())`.

`src/loaders/express.loader.ts` line 22:

```ts
app.post(
  '/webhooks/razorpay',
  express.raw({ type: 'application/json', limit: '1mb' }),
  handleWebhook,
);
// ... below this:
app.use(express.json());
```

### 9.3 Handled event types

```
order.paid
payment.captured
payment.failed
payment.authorized
refund.created
refund.processed
refund.failed
```

Unknown event types: WebhookEvent stored, marked `processed=true` with note
"unhandled event type", returned 200 (Razorpay considers it acknowledged).

---

## 10. Idempotency

### 10.1 Why

Network retries from the client (or from Razorpay) are unavoidable. Without
idempotency, the same enrollment / order / refund could be created multiple
times.

### 10.2 Mechanism

- Client generates a UUID v4 per logical operation.
- Sends as `Idempotency-Key` header (or in body for some POSTs).
- Server computes `requestHash = sha256(method + path + canonicalized_body)`.

On request:

```
SELECT * FROM idempotency_keys WHERE key = $1;

if not exists:
   INSERT (key, requestHash, status='pending', expiresAt = now() + 24h)
   process request
   UPDATE row with response, status = http_status

if exists and requestHash matches:
   if status = 'pending': return 409 IN_PROGRESS
   else: replay cached response

if exists and requestHash differs:
   return 409 IDEMPOTENCY_KEY_REUSED
```

### 10.3 Endpoints that require Idempotency-Key

| Endpoint | Required |
|---|---|
| `POST /api/v1/enrollments` | Required |
| `POST /api/v1/payments/order` | Required |
| `POST /api/v1/payments/refund` | Required |
| `POST /api/v1/admin/razorpay-configs` | Optional but recommended |
| Webhook | Implicit (eventId is the dedupe key) |

### 10.4 TTL

24h for most operations. Refunds: 7 days. Webhook events: forever (audit
trail).

---

## 11. Distributed Locking

### 11.1 Implementation (`src/utils/distributedLock.ts`)

Wraps Redis `SET key value NX PX <ttl_ms>`. Returns a token. Release uses a
small Lua script to compare-and-delete (so a lock acquired by replica A is
not released by replica B).

```ts
const release = await acquireLock(`lock:webhook:${eventId}`, 30_000);
try {
  // critical section
} finally {
  await release();
}
```

### 11.2 Lock keys in use

| Key | Purpose | TTL |
|---|---|---|
| `lock:webhook:{eventId}` | Prevent dupe webhook delivery races | 30s |
| `lock:payment:{paymentId}` | Serialize webhook + reconcile updates to same payment | 30s |
| `lock:cron:{jobName}` | Single-instance cron execution | 5min (covers job duration) |
| `lock:enrollment:{email}:{phone}` | Prevent duplicate enrollment race | 5s |
| `lock:razorpay-cfg:{tenantId}:{mode}:activate` | Atomic activate transaction guard | 10s |

### 11.3 Anti-patterns

- Don't hold a lock across an external API call without watchdog renewal.
- Don't use a lock when an idempotency key would do (locks are about
  ordering; idempotency is about deduping).

---

## 12. Cron Jobs

All cron is implemented as **BullMQ repeatable jobs** across three queues:
`payment-cron`, `external-api-cron`, `followup-cron`. No separate `node-cron`
dependency.

Each cron handler acquires a Redis distributed lock (`lock:cron:<jobname>`) so
only one instance executes the body per interval, even with multiple replicas.

### 12.1 Schedule

| Job | Queue | Pattern | Purpose |
|---|---|---|---|
| `payment-recovery` | `payment-cron` | `*/5 * * * *` | Find IN_PROGRESS / PENDING with no terminal webhook + age > 2 min, query Razorpay, reconcile |
| `payment-reconciliation` | `payment-cron` | `*/30 * * * *` | Full DB-vs-Razorpay sweep over last 24h |
| `payment-expiry` | `payment-cron` | `*/10 * * * *` | Mark payments older than `PAYMENT_TIMEOUT_MIN` as `EXPIRED` |
| `external-api-retry` | `external-api-cron` | `*/15 * * * *` | Retry `ExternalApiLog` rows with `status=FAILED` and `retryCount < API_RETRY_LIMIT`, exponential backoff |
| `dlq-processor` | `external-api-cron` | `0 * * * *` | Scan rows that hit max retries, mark `DEAD_LETTER`, log for ops |
| `follow-up-reminder` | `followup-cron` | `*/10 * * * *` | `nextFollowUpAt <= now` and not CONVERTED/CLOSED -> mark due |
| `stale-leads` | `followup-cron` | `0 */6 * * *` | `lastContactAt < now - 14d` and not CLOSED -> tag `cold` |
| `auto-close` | `followup-cron` | `0 0 * * *` | NOT_INTERESTED with `lastContactAt < now - 30d` -> CLOSED |

### 12.2 Per-cron handler logic

#### `payment-recovery`

```
locked = acquireLock('lock:cron:payment-recovery', 5min)
if !locked: return

stuckPayments = SELECT * FROM payments
  WHERE status IN ('IN_PROGRESS', 'PENDING')
    AND createdAt < now() - 2 min
    AND createdAt > now() - 24 hours
  LIMIT 100

for each:
   acquireLock('lock:payment:{id}', 30s)
   razorpayOrder = razorpay.orders.fetch(razorpayOrderId)
   razorpayPayments = razorpay.orders.fetchPayments(razorpayOrderId)
   reconcileStatus(payment, razorpayOrder, razorpayPayments)
   release()

releaseLock()
```

#### `payment-reconciliation`

Wider sweep over last 24h, regardless of state. Reports drift between local
DB and Razorpay, fixes mismatches.

#### `payment-expiry`

```
UPDATE payments
SET status = 'EXPIRED',
    statusHistory = statusHistory || '{from: <prev>, to: EXPIRED, at: now, reason: ttl}'::jsonb
WHERE status IN ('INITIATED', 'CREATED', 'IN_PROGRESS', 'PENDING')
  AND expiresAt < now();
```

#### `external-api-retry`

```
candidates = SELECT * FROM external_api_logs
  WHERE status = 'FAILED'
    AND retryCount < $API_RETRY_LIMIT
    AND nextRetryAt <= now()
  LIMIT 50

for each: enqueue 'sync-payment-retry' to externalApiCronQueue
```

#### `dlq-processor`

```
UPDATE external_api_logs
SET status = 'DEAD_LETTER'
WHERE status = 'FAILED' AND retryCount >= $API_RETRY_LIMIT
RETURNING id, paymentId, error;

for each: logger.error({ ...row }, 'External API permanently failed - manual intervention')
```

#### `follow-up-reminder`

Marks `priority = 'HIGH'` (or sets a `dueFlag`) on all FollowUp rows whose
`nextFollowUpAt <= now()` and status is open.

#### `stale-leads`

Tags FollowUp rows as `'cold'` when no contact in 14 days, status not in
`CONVERTED|CLOSED`.

#### `auto-close`

Closes FollowUp rows with `status = NOT_INTERESTED` and last contact > 30
days. statusHistory records the transition.

### 12.3 Cron toggles

```
CRON_ENABLED=true    # registerCronJobs() called at startup
QUEUE_ENABLED=true   # workers started at startup
```

In dev with shared Redis, set `CRON_ENABLED=false` on all but one replica
to avoid duplicate registrations. BullMQ `jobId` deduplicates regardless,
but explicit gating is cleaner.

---

## 13. Queue System

### 13.1 Queues and workers

| Queue | Workers | Job names |
|---|---|---|
| `email` | `emailWorker` | `send` |
| `report` | `reportWorker` | `generate` |
| `payment-reconciliation` | `paymentReconciliationWorker` | `process-webhook`, `reconcile-payment` |
| `payment-cron` | `paymentCronWorker` | `payment-recovery`, `payment-reconciliation`, `payment-expiry` |
| `external-api-cron` | `externalApiCronWorker` | `sync-payment`, `external-api-retry`, `dlq-processor` |
| `followup-cron` | `followUpCronWorker` | `follow-up-reminder`, `stale-leads`, `auto-close` |

Each worker dispatches by `job.name` to a service handler.

### 13.2 Retry / backoff

BullMQ default per worker:

```
attempts: 3
backoff: { type: 'exponential', delay: 1000 }
removeOnComplete: 100
removeOnFail: 500
```

Per-job overrides where needed.

### 13.3 Concurrency

Default 5 per worker. Tune via env per workload. CPU-bound (e.g., report
generation) should stay low; I/O-bound (e.g., external API) can go higher.

### 13.4 Failure handling

- Transient failures: BullMQ retries per backoff.
- Permanent failures: job moves to BullMQ failed list. The `dlq-processor`
  cron + per-domain DLQ handlers surface these.
- Logged at `error` level with `jobId`, `correlationId`, error stack.

---

## 14. External API Integration

### 14.1 Trigger

When a `Payment` reaches `SUCCESS` (set by the webhook handler in the same
transaction), a `sync-payment` job is enqueued onto `externalApiCronQueue`.

### 14.2 Flow

```
externalApiCronWorker
  -> syncUserAfterPayment(paymentId)
  -> load Payment + Enrollment via Prisma include
  -> build payload (name, email, phone, role, education, transactionId, amount, currency, paidAt)
  -> insert ExternalApiLog row (status=PENDING)
  -> for attempt in 1..3:
       try:
         response = client.postUser(payload, { timeout: EXTERNAL_API_TIMEOUT_MS })
         if 2xx:
            UPDATE log SET status=SUCCESS, responseStatus, responseBody
            return
         elif 401:
            await client.refreshToken()
            continue (one extra try)
         elif 4xx:
            UPDATE log SET status=FAILED, error=<msg>, retryCount=999  # don't retry client errors
            return
         else: # 5xx
            error = response.text
       catch network_error:
         error = err.message
       sleep(backoff[attempt])  # 1s, 2s, 4s
  -> after loop: UPDATE log SET status=FAILED, retryCount=3, nextRetryAt=now()+15min
  -> external-api-retry cron picks up, retries up to API_RETRY_LIMIT total
  -> on max retries: dlq-processor marks DEAD_LETTER, logs error
```

### 14.3 Token refresh

The client maintains an in-memory access token plus refresh token in Redis
(if the downstream API supports OAuth refresh). On 401:

```
1. acquire lock:external-api:token-refresh
2. refresh token via downstream's /oauth/refresh
3. update Redis: external-api:access-token (TTL = expires_in - 60s)
4. release lock
5. retry original call once with new token
```

Multiple concurrent 401s coalesce on the same lock so we only refresh once.

### 14.4 DLQ

Rows with `status=DEAD_LETTER` are visible via:

```
GET /api/v1/admin/external-api-logs?status=DEAD_LETTER
```

Manual recovery: an admin endpoint can be added to re-enqueue (out of
current scope — surfaced via logs only).

### 14.5 Idempotency to downstream

Each call sends an `Idempotency-Key: <ExternalApiLog.id>` header. Downstream
should treat it as a dedup key.

---

## 15. Marketing CRM

### 15.1 Status flow

```
NEW -> CONTACTED -> FOLLOW_UP -> CALLBACK -> PAYMENT_PENDING -> CONVERTED -> CLOSED
                                                            -> NOT_INTERESTED -> CLOSED
```

Auto-rules applied by `followups.service.addInteraction`:

- `userResponse=PAYMENT_DONE` -> status `CONVERTED`
- `userResponse=NOT_INTERESTED` -> status `CLOSED`
- `userResponse=CALL_BACK` -> status `CALLBACK`, set `nextFollowUpAt` from
  payload
- `userResponse=FOLLOW_UP_LATER` -> status `FOLLOW_UP`, set `nextFollowUpAt`
- All cases:
  - `callAttempts++`
  - `lastContactAt = now()`
  - Append to `history[]`: `{ at, by, action, prevStatus, newStatus }`

### 15.2 Priority + tagging

- `priority` (LOW | MEDIUM | HIGH) assigned at creation, can be edited by
  marketing or auto-bumped to HIGH by `follow-up-reminder` cron.
- `tags`: free-form (`hot`, `warm`, `cold`). The `stale-leads` cron auto-tags
  `cold`.

### 15.3 paymentIntent

```json
{
  "interested": true,
  "expectedAmount": 9900000,
  "expectedDate": "2026-05-10T00:00:00.000Z"
}
```

Used by reports to forecast pipeline value.

### 15.4 history

Append-only audit per FollowUp:

```json
[
  { "at": "...", "by": "user_xx", "action": "STATUS_CHANGE", "from": "NEW", "to": "CONTACTED" },
  { "at": "...", "by": "user_xx", "action": "INTERACTION", "type": "CALL", "outcome": "CONNECTED" },
  { "at": "...", "by": "user_xx", "action": "NOTE", "snippet": "Wants discount" }
]
```

---

## 16. RBAC

### 16.1 Roles

`UserRole` enum (Prisma):

```
SUPER_ADMIN | SCHOOL_ADMIN | ADMIN | MARKETING | TEACHER | STUDENT | PARENT
```

### 16.2 Capability matrix

| Capability | SUPER_ADMIN | ADMIN | MARKETING | SCHOOL_ADMIN | TEACHER | STUDENT |
|---|---|---|---|---|---|---|
| Manage Razorpay configs | Yes | No | No | No | No | No |
| View admin dashboards | Yes | Yes | No | No | No | No |
| List enrollments (cross-tenant) | Yes | No | No | No | No | No |
| List enrollments (own tenant) | Yes | Yes | Yes | Yes | No | No |
| Issue refunds | Yes | Yes | No | No | No | No |
| Manage follow-ups | Yes | Yes | Yes | No | No | No |
| Add call interactions | Yes | Yes | Yes | No | No | No |
| Manage tenants | Yes | No | No | No | No | No |
| Manage users (own tenant) | Yes | Yes | No | Yes | No | No |
| View own profile | Yes | Yes | Yes | Yes | Yes | Yes |
| Submit enrollment (public) | Yes | Yes | Yes | Yes | Yes | Yes |
| Heartbeat / verify (own payment) | Yes | Yes | Yes | Yes | Yes | Yes |

### 16.3 Enforcement

- JWT verified by `auth.middleware.ts`.
- `requireRole(...roles)` middleware applied at the route or router level.
- `tenantResolver.middleware.ts` reads `X-Tenant-Id` header, verifies the
  user is allowed access to that tenant (or is `SUPER_ADMIN`), and sets
  `req.tenant`.
- Repository functions accept `tenantId` and scope queries; `SUPER_ADMIN`
  callers can pass `null` to bypass.

---

## 17. Security

### 17.1 Defenses in place

- `helmet` for security headers (CSP, HSTS, X-Frame-Options, etc.)
- `hpp` against HTTP parameter pollution
- `xss` for input sanitization on free-text fields
- `express-rate-limit` with Redis store: 60 req/min per IP+user
- `express-slow-down` for progressive throttling beyond rate limit
- JWT with short access expiry (15m) + refresh token rotation (7d)
- Razorpay webhook HMAC SHA256 signature verification with constant-time
  comparison
- AES-256-GCM encryption at rest for `RazorpayConfig.keySecret` and
  `webhookSecret` (key in env, never in DB)
- `Idempotency-Key` header support on every state-changing endpoint
- Distributed locks around webhook + payment + cron processing
- `CORS` configured per environment; default disallows `*`
- Bcrypt password hashing (12 rounds)
- All money in integers (paise) — no float precision attacks
- SQL injection: Prisma parameterizes everything by default
- Prototype pollution: input validation via Zod (whitelisted fields only)
- Mass assignment: services map DTOs explicitly to model fields

### 17.2 Encryption details

`src/utils/encryption.ts`:

```
encrypt(plaintext, key) -> { iv: hex, tag: hex, ciphertext: hex }
decrypt({ iv, tag, ciphertext }, key) -> plaintext
maskSecret(plaintext) -> 'xxxx****xxxx' (first 4, last 4)

Algorithm: AES-256-GCM
Key:       CONFIG_ENCRYPTION_KEY (32 bytes / 64 hex chars)
IV:        random 12 bytes per encryption
Tag:       16 bytes (auth tag)
```

Stored format in DB: `iv:tag:ciphertext` (colon-delimited hex).

### 17.3 Secrets handling

- All secrets in environment variables, validated by Zod at startup.
- `.env` is gitignored.
- `.env.example` ships placeholders only.
- `CONFIG_ENCRYPTION_KEY` rotates with re-encryption migration (out of
  current scope).

---

## 18. Observability

### 18.1 Logging

- **Pino** structured JSON logs.
- **cls-hooked** AsyncLocalStorage propagates `correlationId`.
- Every request gets a unique `correlationId`, propagated through services,
  workers, and outbound API calls.
- Worker jobs receive `correlationId` from job data.
- Log level via `LOG_LEVEL` env (`info` default, `debug` in dev).
- Pretty-printed locally via `pino-pretty`; JSON in production.

Sample log line:

```json
{
  "level": 30,
  "time": 1714566225123,
  "correlationId": "uuid",
  "userId": "u_xx",
  "tenantId": "t_xx",
  "module": "payments.service",
  "msg": "Payment captured via webhook",
  "paymentId": "...",
  "amountPaise": 11682000
}
```

### 18.2 Metrics (seams)

- Health endpoint at `/api/v1/health` reports DB + Redis status, memory,
  uptime, queue depth.
- Hooks for Prometheus / Datadog can be added at `src/middlewares/`.
- Critical counters (logged for now): payments succeeded/failed/expired,
  webhook duplicates, idempotency hits, lock contention.

### 18.3 Tracing

- `correlationId` end-to-end is the lightweight equivalent.
- For full distributed tracing, add OpenTelemetry instrumentation at
  `src/loaders/express.loader.ts`. Out of current scope.

### 18.4 Alerts

Log-based alerts are sufficient for local + staging:

- Any `error` log -> aggregator (pino logs to stdout, container picks up).
- DLQ rows -> alert ops on appearance.
- Lock contention spikes -> investigate.

For production, wire Slack / PagerDuty at the log aggregator (e.g., Loki
alerts, Datadog monitors). Out of code scope.

---

## 19. Environment Variables

Full list in `.env.example`. All variables Zod-validated at startup; missing
or malformed values fail loudly before binding.

### 19.1 Server

```
NODE_ENV                 = development | production | test
PORT                     = 3000
LOG_LEVEL                = info | debug | warn | error
LOG_PRETTY               = true | false
SWAGGER_ENABLED          = true | false
CORS_ORIGINS             = comma-separated list of origins
```

### 19.2 Database

```
DATABASE_URL             = postgresql://user:pass@host:port/db?schema=public
POSTGRES_USER            = postgres
POSTGRES_PASSWORD        = postgres
POSTGRES_DB              = kommon_school
POSTGRES_PORT            = 5432
```

### 19.3 Redis

```
REDIS_HOST               = localhost
REDIS_PORT               = 6379
REDIS_PASSWORD           = (optional)
REDIS_DB                 = 0
```

### 19.4 JWT

```
JWT_ACCESS_SECRET        = <openssl rand -hex 32>
JWT_REFRESH_SECRET       = <openssl rand -hex 32>
JWT_ACCESS_EXPIRY        = 15m
JWT_REFRESH_EXPIRY       = 7d
BCRYPT_SALT_ROUNDS       = 12
```

### 19.5 Multi-tenancy

```
TENANT_RESOLUTION_STRATEGY = header
TENANT_HEADER_NAME         = X-Tenant-Id
```

### 19.6 Razorpay (fallback when no DB config is active)

```
RAZORPAY_MODE            = test | live
RAZORPAY_KEY_ID          = rzp_test_xxxxxxxxxxxxx
RAZORPAY_KEY_SECRET      = (from Razorpay dashboard)
RAZORPAY_WEBHOOK_SECRET  = (set in Razorpay webhook config)
```

### 19.7 Cron + queue toggles

```
CRON_ENABLED             = true
QUEUE_ENABLED            = true
PAYMENT_TIMEOUT_MIN      = 15
MAX_RETRY                = 3
API_RETRY_LIMIT          = 5
```

### 19.8 External API

```
EXTERNAL_API_URL         = https://api.example.com/v1
EXTERNAL_API_TOKEN       = replace_me
EXTERNAL_API_TIMEOUT_MS  = 10000
```

### 19.9 Encryption

```
# Generate with: openssl rand -hex 32
# Default in .env.example is 64 zeros - DO NOT use in production.
CONFIG_ENCRYPTION_KEY    = 0000000000000000000000000000000000000000000000000000000000000000
```

### 19.10 Frontend env

`kommon_school/.env.example`:

```
VITE_API_BASE_URL        = http://localhost:3000/api/v1
```

---

## 20. Frontend Integration

The React UI is unchanged. Two new files were added under
`kommon_school/`:

### 20.1 `src/services/enrollmentApi.js`

```js
const BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api/v1';

const uuid = () =>
  crypto.randomUUID
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });

async function request(path, { method = 'GET', body, idempotent = false, headers = {} } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(idempotent ? { 'Idempotency-Key': uuid() } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.success) {
    const err = new Error(json?.error?.message || `HTTP ${res.status}`);
    err.code = json?.error?.code;
    err.details = json?.error?.details;
    throw err;
  }
  return json.data;
}

export const createEnrollment = (data) =>
  request('/enrollments', { method: 'POST', body: data, idempotent: true });

export const createPaymentOrder = (enrollmentId, amount, breakdown = {}) =>
  request('/payments/order', {
    method: 'POST',
    body: { enrollmentId, amount, currency: 'INR', ...breakdown },
    idempotent: true,
  });

export const verifyPayment = (payload) =>
  request('/payments/verify', { method: 'POST', body: payload });

export const heartbeat = (paymentId) =>
  request('/payments/heartbeat', { method: 'POST', body: { paymentId } });

export const getPaymentStatus = (paymentId) =>
  request(`/payments/${paymentId}`);
```

### 20.2 `src/hooks/useEnrollment.js`

```js
import { useState } from 'react';
import { createEnrollment } from '../services/enrollmentApi';

// Wire the existing EnrollModal by replacing setSubmitted(true) with:
//   await submit(data); setSubmitted(true);
export function useEnrollment() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);

  const submit = async (payload) => {
    setLoading(true);
    setError(null);
    try {
      const result = await createEnrollment(payload);
      setData(result);
      return result;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  return { submit, loading, error, success: !!data, data };
}
```

### 20.3 Wiring

Existing modal `src/components/common/EnrollModal.jsx` is unchanged. To wire
it to the backend, add at the top:

```js
import { useEnrollment } from '../../hooks/useEnrollment'
```

And in the component:

```js
const { submit } = useEnrollment()
```

Replace the `next()` function's success path:

```js
// before:
if (step < STEPS.length - 1) setStep(s => s + 1)
else setSubmitted(true)

// after:
if (step < STEPS.length - 1) {
  setStep(s => s + 1)
} else {
  try {
    await submit(data)
    setSubmitted(true)
  } catch (err) {
    setErrors({ form: err.message })
  }
}
```

This three-line change is intentionally NOT applied — the no-UI-changes
rule is in effect. The hook is ready when the rule is lifted.

---

## 21. Build, Run, Test

### 21.1 Prereqs

- Node.js >= 20
- Docker + docker-compose (for Postgres + Redis)
- npm >= 10

### 21.2 Bootstrap

```bash
cd "D:/Satish Working Projects/kommon_school_project/backend"

# 1. Start Postgres + Redis
docker-compose up -d

# 2. Generate keys, paste into .env
openssl rand -hex 32   # JWT_ACCESS_SECRET
openssl rand -hex 32   # JWT_REFRESH_SECRET
openssl rand -hex 32   # CONFIG_ENCRYPTION_KEY

# 3. Install + Prisma
npm install
npm run prisma:generate
npm run prisma:migrate:deploy

# 4. Seed (optional but useful for testing)
npm run prisma:seed

# 5. Start dev server (workers + cron auto-register)
npm run dev
```

### 21.3 Production

```bash
npm run build
npm run start              # single process
# or
npm run start:cluster      # PM2 cluster mode (ecosystem.config.js)
```

### 21.4 Verification commands

```bash
npm run build              # tsc + tsc-alias - passes clean (0 errors)
npm run lint               # noisy due to pre-existing eslint resolver config bug
npm run lint:fix           # auto-fixes some
npm run format             # prettier
npm run test               # requires live DB + Redis
npm run test:coverage
```

### 21.5 Docker

```bash
docker-compose up -d              # full stack incl. backend
docker-compose logs -f
docker-compose logs -f app
docker-compose down
docker-compose down -v            # nukes volumes (data loss!)
```

### 21.6 Prisma utilities

```bash
npm run prisma:generate           # regenerate client after schema change
npm run prisma:migrate            # interactive new migration (dev)
npm run prisma:migrate:deploy     # apply pending migrations (prod)
npm run prisma:studio             # GUI at http://localhost:5555
npm run prisma:seed               # run seed.ts
```

---

## 22. Test Credentials

> **Never use these in production.** All values below come from the existing
> seed file and `docker-compose.yml` defaults. Production deployments must
> override every secret via environment variables.

### 22.1 Database (PostgreSQL via docker-compose)

```
Host:     localhost
Port:     5432
User:     postgres
Password: postgres
Database: kommon_school
URL:      postgresql://postgres:postgres@localhost:5432/kommon_school?schema=public
```

### 22.2 Redis (via docker-compose)

```
Host: localhost
Port: 6379
No auth.
```

### 22.3 JWT secrets (generate per environment)

```bash
openssl rand -hex 32   # -> JWT_ACCESS_SECRET
openssl rand -hex 32   # -> JWT_REFRESH_SECRET
```

```
JWT_ACCESS_EXPIRY  = 15m
JWT_REFRESH_EXPIRY = 7d
```

### 22.4 Encryption key for RazorpayConfig secrets at rest

```bash
openssl rand -hex 32   # -> CONFIG_ENCRYPTION_KEY
```

The default in `.env.example` is 64 zeros. The system will start with that
default but stored secrets will be trivially decryptable. Generate a real
one before any data is stored in production.

### 22.5 Application user credentials (created by `npm run prisma:seed`)

| Role | Email | Password | Tenant |
|---|---|---|---|
| `SUPER_ADMIN` | `superadmin@kommon.school` | `SuperAdmin@123` | none (cross-tenant) |
| `SCHOOL_ADMIN` | `admin@greenwood.edu` | `SchoolAdmin@123` | `greenwood-high` |
| `TEACHER` | `teacher@greenwood.edu` | `Teacher@123` | `greenwood-high` |
| `STUDENT` | `student@greenwood.edu` | `Student@123` | `greenwood-high` |

**Gap:** the existing seed does not yet create `ADMIN` or `MARKETING` users
(roles added for this work). Until the seed is extended, log in as
`SUPER_ADMIN` to test admin-panel and follow-up endpoints. To create admin /
marketing users via API, log in as super admin and call `POST /api/v1/users`
with `role: "ADMIN"` or `role: "MARKETING"`.

### 22.6 Razorpay test mode

Razorpay test keys must be obtained from your own Razorpay dashboard
<https://dashboard.razorpay.com>.

**Bootstrap mode** (env-only, no DB record):

```
RAZORPAY_MODE              = test
RAZORPAY_KEY_ID            = rzp_test_XXXXXXXXXXXXXXX
RAZORPAY_KEY_SECRET        = (from Razorpay dashboard)
RAZORPAY_WEBHOOK_SECRET    = (set in Razorpay webhook config)
```

**Active config mode** (recommended): create configs via
`POST /api/v1/admin/razorpay-configs` as `SUPER_ADMIN`. Secrets are encrypted
at rest. Razorpay client reads the active config from DB with a 60-second
Redis cache.

### 22.7 Razorpay test cards (Razorpay-published, public)

```
Card number:  4111 1111 1111 1111
Expiry:       any future MM/YY
CVV:          any 3 digits
Name:         any
OTP / 3DS:    1234
```

Test UPI:

```
success@razorpay
failure@razorpay
```

Test netbanking: choose any bank, click Success / Fail on the simulator page.

### 22.8 External downstream API

Stub. Real endpoint to be supplied by the integrating ERP team.

```
EXTERNAL_API_URL         = https://api.example.com/v1
EXTERNAL_API_TOKEN       = replace_me
EXTERNAL_API_TIMEOUT_MS  = 10000
```

### 22.9 Frontend env

`kommon_school/.env`:

```
VITE_API_BASE_URL = http://localhost:3000/api/v1
```

---

## 23. Smoke Test Sequence

After bootstrap (section 21.2), run these in order. They exercise the full
happy path.

```bash
# 1. Health check
curl -s http://localhost:3000/api/v1/health | jq .

# Expected: { "success": true, "data": { "status": "ok", "db": "ok", "redis": "ok", ... } }

# 2. Login as super admin
ACCESS=$(curl -s -X POST http://localhost:3000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"superadmin@kommon.school","password":"SuperAdmin@123"}' \
  | jq -r '.data.accessToken')

echo "Access token: ${ACCESS:0:20}..."

# 3. Create an enrollment (public, idempotent)
ENROLL=$(curl -s -X POST http://localhost:3000/api/v1/enrollments \
  -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{
    "name": "Priya Sharma",
    "email": "priya@example.com",
    "phone": "9876543210",
    "role": "Student",
    "education": "Undergraduate",
    "readiness": "Beginner",
    "source": "Google Search"
  }' | jq -r '.data.id')

echo "Enrollment ID: $ENROLL"

# 4. Idempotency replay - same key returns cached response
curl -s -X POST http://localhost:3000/api/v1/enrollments \
  -H 'Content-Type: application/json' \
  -H "Idempotency-Key: SAME-KEY-AS-LAST-REQUEST" \
  -d '{ ... same body ... }'

# 5. Admin dashboard
curl -s http://localhost:3000/api/v1/admin/dashboard \
  -H "Authorization: Bearer $ACCESS" | jq .

# 6. List enrollments
curl -s 'http://localhost:3000/api/v1/admin/enrollments?page=1&limit=20' \
  -H "Authorization: Bearer $ACCESS" | jq .

# 7. Create Razorpay config
curl -s -X POST http://localhost:3000/api/v1/admin/razorpay-configs \
  -H "Authorization: Bearer $ACCESS" \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Test Account",
    "mode": "test",
    "keyId": "rzp_test_xxxxx",
    "keySecret": "your_test_secret",
    "webhookSecret": "your_webhook_secret"
  }'

# 8. Activate it
CFG_ID=$(curl -s http://localhost:3000/api/v1/admin/razorpay-configs \
  -H "Authorization: Bearer $ACCESS" | jq -r '.data[0].id')
curl -s -X POST "http://localhost:3000/api/v1/admin/razorpay-configs/$CFG_ID/activate" \
  -H "Authorization: Bearer $ACCESS"

# 9. Create payment order
ORDER=$(curl -s -X POST http://localhost:3000/api/v1/payments/order \
  -H "Authorization: Bearer $ACCESS" \
  -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $(uuidgen)" \
  -d "{
    \"enrollmentId\": \"$ENROLL\",
    \"amount\": 9900000,
    \"currency\": \"INR\"
  }" | jq -r '.data.razorpayOrderId')

echo "Razorpay order: $ORDER"

# 10. (Frontend pays via Razorpay Checkout, posts /verify)

# 11. (Razorpay sends webhook -> /webhooks/razorpay)

# 12. Check final status
curl -s "http://localhost:3000/api/v1/payments/$PAYMENT_ID" \
  -H "Authorization: Bearer $ACCESS" | jq '.data.status'

# 13. List external API logs
curl -s 'http://localhost:3000/api/v1/admin/external-api-logs?page=1&limit=20' \
  -H "Authorization: Bearer $ACCESS" | jq .

# 14. Create follow-up + interaction
FU=$(curl -s -X POST http://localhost:3000/api/v1/follow-ups \
  -H "Authorization: Bearer $ACCESS" \
  -H 'Content-Type: application/json' \
  -d "{ \"enrollmentId\": \"$ENROLL\", \"priority\": \"HIGH\" }" \
  | jq -r '.data.id')

curl -s -X POST "http://localhost:3000/api/v1/follow-ups/$FU/interactions" \
  -H "Authorization: Bearer $ACCESS" \
  -H 'Content-Type: application/json' \
  -d '{
    "type": "CALL",
    "outcome": "CONNECTED",
    "userResponse": "CALL_BACK",
    "callDuration": 215,
    "remarks": "Will discuss with parents and call back",
    "nextAction": "CALLBACK",
    "nextFollowUpAt": "2026-05-03T10:00:00.000Z"
  }'

# 15. Follow-up report
curl -s http://localhost:3000/api/v1/admin/follow-ups/report \
  -H "Authorization: Bearer $ACCESS" | jq .
```

### 23.1 Webhook smoke test (without going through Razorpay UI)

Use the Razorpay test webhook tool in dashboard or curl with a valid
signature:

```bash
RAW='{"event":"payment.captured","payload":{"payment":{"entity":{"id":"pay_test","order_id":"order_test","amount":9900000,"currency":"INR","status":"captured"}}}}'
SIG=$(printf '%s' "$RAW" | openssl dgst -sha256 -hmac "$RAZORPAY_WEBHOOK_SECRET" | awk '{print $2}')

curl -s -X POST http://localhost:3000/webhooks/razorpay \
  -H "Content-Type: application/json" \
  -H "X-Razorpay-Signature: $SIG" \
  --data-raw "$RAW"
```

Expected: 200 OK; the webhook is logged in `WebhookEvent`, the corresponding
payment row transitions to `SUCCESS`, and a `sync-payment` job appears in the
`external-api-cron` queue.

---

## 24. Operational Runbook

### 24.1 Routine checks

| Check | Frequency | Command |
|---|---|---|
| Health endpoint | Every 30s (load balancer) | `curl /api/v1/health` |
| Pending payments older than 30 min | Hourly | `SELECT count(*) FROM payments WHERE status IN ('IN_PROGRESS','PENDING') AND createdAt < now() - interval '30 minutes'` |
| DLQ rows | Hourly | `SELECT count(*) FROM external_api_logs WHERE status = 'DEAD_LETTER'` |
| Webhook event backlog | Hourly | `SELECT count(*) FROM webhook_events WHERE processed = false AND createdAt < now() - interval '5 minutes'` |
| BullMQ failed jobs | Hourly | BullMQ admin UI or Redis `XLEN bull:<queue>:failed` |

### 24.2 Common operations

**Re-process a webhook**:

```sql
UPDATE webhook_events SET processed = false, error = null WHERE id = 'wh_xxx';
```

Then enqueue manually:

```bash
# In a node REPL or admin endpoint:
paymentReconciliationQueue.add('process-webhook', { eventId: 'wh_xxx' })
```

**Manual reconciliation of a single payment**:

```bash
curl -X POST http://localhost:3000/api/v1/admin/payments/$ID/reconcile \
  -H "Authorization: Bearer $ACCESS"
```

(Endpoint can be added if needed; currently reconciliation is cron-driven.)

**Re-encrypt RazorpayConfigs after rotating CONFIG_ENCRYPTION_KEY**: write a
one-off migration script:

```ts
// 1. decrypt with OLD key
// 2. encrypt with NEW key
// 3. UPDATE razorpay_configs SET ...
```

Out of current scope.

**Clear stuck idempotency keys** (debugging only):

```sql
DELETE FROM idempotency_keys WHERE expiresAt < now();
```

### 24.3 Incident playbook

**Symptom: Razorpay webhooks failing with 400**

1. Verify `RAZORPAY_WEBHOOK_SECRET` matches the secret set in Razorpay dashboard.
2. Confirm `/webhooks/razorpay` is mounted **before** `express.json()` —
   check `src/loaders/express.loader.ts`.
3. Confirm `express.raw({ type: 'application/json' })` middleware is on the
   route.
4. Inspect raw request bytes vs computed HMAC.

**Symptom: Payments stuck in IN_PROGRESS forever**

1. Check `payment-recovery` cron is running: BullMQ dashboard or logs for
   `Payment recovery cron started` every 5 min.
2. Verify Razorpay credentials are valid (active config or env fallback).
3. Manually invoke recovery: enqueue `payment-recovery` job once.

**Symptom: Duplicate enrollments despite idempotency**

1. Confirm client is sending `Idempotency-Key` header.
2. Check `idempotency_keys` table — was the key recorded?
3. Verify `requestHash` matches between attempts (tiny body differences
   create a new hash and bypass dedup).

**Symptom: External API DLQ filling up**

1. Inspect `error` column on DLQ rows — common cause: 4xx from downstream.
2. Verify `EXTERNAL_API_TOKEN` is current.
3. Manually re-enqueue after fixing root cause:
   ```sql
   UPDATE external_api_logs SET status='FAILED', retryCount=0 WHERE id = 'log_xxx';
   ```

---

## 25. Open TODOs

The following items were intentionally deferred and are not blockers for
running the system. They should be revisited before production go-live.

| TODO | Owner | Effort | Notes |
|---|---|---|---|
| Tests for new modules (enrollments, payments, follow-ups, externalApi, admin, razorpayConfigs) | dev | 2-3 days | Unit + integration; needs test DB + Redis |
| Seed `ADMIN` and `MARKETING` users | dev | 30 min | Extend `prisma/seed.ts` |
| Wire `EnrollModal.jsx` to `useEnrollment` hook | dev | 30 min | 3-line change, blocked by no-UI rule |
| External API contract finalization | integration | varies | Real downstream endpoint path, payload shape |
| DLQ external alerting (PagerDuty / Slack / email) | infra | 1 day | Wire log aggregator alerts |
| RazorpayConfig soft delete (deletedAt column) | dev | 1 hour | Add migration if audit trail required |
| Rotate `CONFIG_ENCRYPTION_KEY` migration script | dev | 2 hours | One-off when key rotation is needed |
| eslint resolver config fix | dev | 30 min | `.eslintrc.js` `settings.import/resolver` |
| Manual reconciliation endpoint per payment | dev | 2 hours | `POST /api/v1/admin/payments/:id/reconcile` |
| OpenTelemetry tracing | infra | 1 day | Optional, replaces ad hoc correlationId |
| Dashboard CSV export | dev | half day | For finance/ops reporting |
| Multi-currency support beyond INR | dev | 1 day | Currently INR only end to end |
| Webhook replay UI in admin panel | dev | 1 day | Currently DB-only |

---

## 26. File Inventory

### 26.1 New files (backend)

```
ARCHITECTURE_DECISIONS.md
BACKEND_IMPLEMENTATION.md                      # this file
prisma/migrations/20260501000000_add_payments_enrollments_followups/
src/jobs/cron.ts
src/utils/encryption.ts
src/utils/distributedLock.ts
src/utils/cache.ts
src/utils/razorpay.ts                          # rewritten to read DB-active config
src/middlewares/requestContext.middleware.ts
src/middlewares/tenantResolver.middleware.ts
src/middlewares/validate.middleware.ts
src/modules/enrollments/{controller,service,repository,schema,routes}.ts
src/modules/payments/{controller,service,repository,schema,routes,webhook}.ts
src/modules/followups/{controller,service,repository,schema,routes}.ts
src/modules/externalApi/{client,service,repository}.ts
src/modules/admin/{controller,service,repository,routes}.ts
src/modules/admin/razorpayConfigs/{controller,service,repository,schema,routes}.ts
```

### 26.2 New files (frontend)

```
kommon_school/src/services/enrollmentApi.js
kommon_school/src/hooks/useEnrollment.js
kommon_school/.env.example
```

### 26.3 Modified files (backend)

```
prisma/schema.prisma                           # +8 models, extended UserRole enum
src/config/env.ts                              # +12 env vars, all Zod-validated
src/jobs/queues.ts                             # +3 queues
src/jobs/workers.ts                            # +4 workers (incl. paymentReconciliation), QUEUE_ENABLED gating
src/loaders/express.loader.ts                  # webhook mounted before JSON parser
src/routes/v1.ts                               # +4 route mounts (enrollments, payments, follow-ups, admin)
src/server.ts                                  # startWorkers + registerCronJobs in listen callback
.env.example                                   # +13 vars
.env                                           # mirrored
README.md                                      # endpoint + cron summary appended
```

---

## 27. Summary

Production-grade backend covering enrollment, Razorpay payment processing
with state machine + idempotency + ledger + webhook source-of-truth,
marketing CRM with full interaction tracking, admin dashboards, external API
sync with retry and DLQ, eight scheduled cron jobs running on BullMQ, RBAC
across three new roles, AES-256-GCM encryption for stored Razorpay
credentials, distributed locking for safe horizontal scaling.

`npm run build` passes clean. The system is ready for QA against a live
Razorpay test account.

### Quick endpoint recap

```
POST   /webhooks/razorpay                          (Razorpay webhook, raw body, HMAC verified)

POST   /api/v1/enrollments                         (public, idempotent)
GET    /api/v1/enrollments                         (admin)

POST   /api/v1/payments/order
POST   /api/v1/payments/verify
POST   /api/v1/payments/heartbeat
POST   /api/v1/payments/refund                     (admin)
GET    /api/v1/payments/:id

POST   /api/v1/follow-ups
GET    /api/v1/follow-ups
POST   /api/v1/follow-ups/:id/interactions
POST   /api/v1/follow-ups/:id/notes
PATCH  /api/v1/follow-ups/:id/status

GET    /api/v1/admin/dashboard
GET    /api/v1/admin/enrollments
GET    /api/v1/admin/payments
GET    /api/v1/admin/payments/failed
GET    /api/v1/admin/external-api-logs
GET    /api/v1/admin/follow-ups/report

POST   /api/v1/admin/razorpay-configs              (SUPER_ADMIN)
GET    /api/v1/admin/razorpay-configs
PATCH  /api/v1/admin/razorpay-configs/:id
POST   /api/v1/admin/razorpay-configs/:id/activate
DELETE /api/v1/admin/razorpay-configs/:id

+ /api/v1/health, /api/v1/auth/*, /api/v1/users, /api/v1/tenants, /api/v1/students
```

### Quick cron recap

| Job | Pattern |
|---|---|
| `payment-recovery` | `*/5 * * * *` |
| `payment-reconciliation` | `*/30 * * * *` |
| `payment-expiry` | `*/10 * * * *` |
| `external-api-retry` | `*/15 * * * *` |
| `dlq-processor` | `0 * * * *` |
| `follow-up-reminder` | `*/10 * * * *` |
| `stale-leads` | `0 */6 * * *` |
| `auto-close` | `0 0 * * *` |

### Quick credentials recap

```
DB:       postgres / postgres @ localhost:5432 / kommon_school
Redis:    localhost:6379 (no auth)
Login:    superadmin@kommon.school / SuperAdmin@123
Test card: 4111 1111 1111 1111  any future MM/YY  any CVV  3DS=1234
Test UPI:  success@razorpay
```

End of document.
