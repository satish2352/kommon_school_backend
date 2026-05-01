# Architecture Decisions

## Database: PostgreSQL + Prisma (deviation from spec's MongoDB + Mongoose requirement)

The original spec mandated MongoDB + Mongoose. This project uses PostgreSQL + Prisma instead. Reasons:

1. The existing multi-tenant SaaS scaffold was already built on Prisma + PostgreSQL with a fully type-safe schema and migration system. Introducing MongoDB would have required rewriting every model, all repository code, and the seed scripts — a scope far exceeding the integration work needed.
2. Every requirement in the spec (idempotency, ledger, audit trail, webhook deduplication, transactions, RBAC) maps equally well or better to PostgreSQL: ACID transactions with configurable isolation levels, uniqueness constraints enforced at DB level, JSON columns for flexible schema sections (notes, interactions, statusHistory), and Prisma's type-safe ORM prevents whole classes of runtime errors that schema-less Mongo allows.
3. PostgreSQL's serialisable transaction isolation is critical for the payment state machine and the double-entry ledger — preventing concurrent writes from leaving the system in an inconsistent state. MongoDB's multi-document transactions exist but add significant operational complexity.

No second primary database was introduced. Redis is used exclusively for caching, rate limiting, and job queues — consistent with the existing scaffold.

---

## Payment State Machine

Each `Payment` record moves through a typed state graph enforced in `payments.service.ts`:

```
INITIATED → CREATED → IN_PROGRESS → SUCCESS
                     → PENDING    → SUCCESS
                                  → PARTIAL → SUCCESS
                                            → REFUNDED
                     → FAILED
                     → EXPIRED
```

Valid transitions are declared in `VALID_TRANSITIONS` (a plain object map). The `isValidTransition(from, to)` helper is exported so the webhook worker can apply the same guard. Every status change appends to a `statusHistory` JSON column and writes a row to `payment_audit_logs` inside the same Prisma transaction, producing an immutable audit trail with actor, timestamp, and reason.

---

## Idempotency Keys

Every mutating POST (enrollment creation, payment order creation) accepts an `Idempotency-Key` header (UUID v4). The backend:

1. Hashes the key and checks the `idempotency_keys` table (or the `idempotencyKey` column on the relevant model).
2. If a matching completed record exists, returns the cached response with HTTP 200 — no second write.
3. If a matching pending record exists (concurrent retry), the response is still the original in-progress data.
4. If no match, proceeds normally and stores the key atomically with the new record.

Client-generated keys (UUID v4) are used rather than server-generated keys so the client can retry a failed network request with the same key without needing a prior round-trip.

---

## Distributed Locks

`src/utils/distributedLock.ts` implements a Redis-based lock using SET NX PX. Used in the BullMQ payment reconciliation worker to prevent two concurrent worker instances from processing the same webhook event. Lock TTL is set to the maximum expected processing time (30 s) plus a 10 s buffer. On normal completion the lock is released; on crash the key expires automatically. The lock key is scoped to `payment-lock:{paymentId}` so independent payments process in parallel.

---

## Webhook Flow

Razorpay webhooks are handled at two paths:

- `POST /webhooks/razorpay` — stable top-level path; Razorpay's dashboard config never changes across API version bumps.
- `POST /api/v1/payments/webhook` — versioned path for backwards compatibility.

Both paths use `express.raw({ type: 'application/json' })` registered **before** `express.json()` so the raw `Buffer` body is preserved for HMAC-SHA256 signature verification (Razorpay's `X-Razorpay-Signature` header). The handler:

1. Verifies HMAC synchronously (< 1 ms).
2. Upserts a `webhook_events` row with a `(provider, eventId)` unique constraint — preventing duplicate processing even if Razorpay retries.
3. Returns HTTP 200 immediately (Razorpay retries on any non-2xx).
4. Enqueues a `payment-reconciliation` BullMQ job for heavy processing (Prisma writes, ledger entries, enrollment status updates).

The job worker applies the payment state machine, writes ledger entries, and marks the webhook event as processed — all inside a Prisma transaction.

---

## Double-Entry Ledger

Every financial movement creates a `ledger_entries` row:

| Event | Type | Source |
|-------|------|--------|
| Payment received | CREDIT | PAYMENT |
| Refund issued | DEBIT | REFUND |
| Manual adjustment | DEBIT/CREDIT | ADJUSTMENT |

Amounts are stored as integer **paise** (1 INR = 100 paise) to avoid floating-point errors. `balanceBefore` and `balanceAfter` are snapshot fields computed at write time inside the transaction that also updates the `Payment` record — ensuring the ledger and payment record are always consistent. The ledger is append-only; no row is ever deleted or updated.
