# Code Reviewer Memory

Private log for the code_reviewer agent. Read on startup, append after every
review.

---

## T-2026-012 — Review 1 (2026-05-09T00:00:00Z)

- task_id: T-2026-012
- iteration: 1
- verdict: ❌ Issues Found
- blockers:
  1. schema.prisma line 414: `highlightLabel` on Plan model has no `@map("highlight_label")` annotation — Prisma will create/expect a camelCase column `highlightLabel` in the DB, breaking consistency with all other multi-word columns in this codebase and with the migration SQL which does not add this column at all. The migration will silently fail on fresh DB or mismatch on existing DB.
  2. plan.service.js selectForEnrollment (line 319–378): TOCTOU race — status guard reads enrollment, then update runs as a separate non-transactional write. Two concurrent PATCH calls for the same enrollment can both pass the status guard and double-stamp. Must be a single Prisma interactive transaction.
  3. plan.service.js selectForEnrollment (line 328): `findEnrollmentById` uses `take: 1` on payments, so paymentCount will always be 0 or 1. This is technically correct since any payment row blocks re-select, but the semantics rely on a repository detail not visible at the service layer — not a bug but a hidden coupling.
  4. seed.js seedPlans (line 531): The seed bypasses server-side finalPrice computation and hard-codes finalPrice values directly. If the formula changes, seed values silently diverge from the service computation. Not a runtime blocker but a correctness risk.
  5. migration.sql: On a completely fresh database (no prior plans table), the migration does NOT create the plans or plan_pricing tables at all — it only patches column names on assumed-existing tables. A fresh DB apply will fail with "relation plans does not exist".
- should-fix:
  1. plan.admin.routes.js line 95-99: DELETE /:planId/pricing/:pricingId uses PLANS_UPDATE permission instead of PLANS_DELETE — should use PLANS_DELETE for a destructive deactivate operation.
  2. plan.public.routes.js line 13: listPlanQuerySchema is applied to the public route but that schema includes tier/status filter params — fine for now but exposes admin filter surface publicly.
  3. tests/plans/plan.service.test.js: Tests run against a real DB (PrismaClient direct), not a mock — this is acceptable for integration tests in this project, but test isolation relies on cleanup helpers that silently swallow errors. If cleanup fails (e.g., FK constraint from a payment row), subsequent runs may leave orphaned data.
  4. tests: Test numbering jumps from 5 to 8 then back to 6/7 (comments say "Test 8" before "Test 6"). Cosmetic only but confusing.
- nits:
  1. plan.service.js line 255: `Math.round(base * (1 - discount / 100) * 100) / 100` — rounding to 2 decimal places via multiply-round-divide is correct but fragile for large numbers; Prisma Decimal type handles this better. Low risk.
  2. plan.repository.js line 91: `findUnique` on `planId_durationMonths` compound key — correct. Matches schema @@unique.
  3. plan.admin.routes.js: Route order (status before :id) correctly prevents Express param shadowing — good.
- precedents set:
  - Tests in this project use real PrismaClient against a live test DB (integration test style), not Jest mocks. Acceptable pattern.
  - `@map` annotations are mandatory for all camelCase multi-word field names on all models in this codebase — single-word names (tagline, description, features, status) are exempt.

## T-2026-002 — Review 1 (2026-04-25T06:10:00Z)

- task_id: T-2026-002
- iteration: 1
- verdict: ✅ Approved (after two corrections applied inline)
- corrections made during review:
  1. `accounts_chart_of_accounts` was incorrect — actual table is `accounts_accounts` (from `@Entity({ name: "accounts_accounts" })` in account.entity.ts) — corrected in doc
  2. HTTP status for `VALIDATION_ERROR` was documented as 422 — actual `validate-request.middleware.ts` calls `res.status(400)` — corrected in doc
- precedents set:
  - `VALIDATION_ERROR` response code always uses HTTP 400 in this project (validate-request middleware hardcodes it)
  - `TOO_MANY_REQUESTS` response code exists in ResponseCode enum but has no entry in ResponseConfigMap; the rate-limit handler constructs the 429 JSON directly (same finding as T-2026-001)
- all other documented facts verified:
  - URL /api/app-resident/payment/create: confirmed (mainRoutes.ts line 201)
  - rate limiter: appRateLimiter 100 req/min at line 140: confirmed
  - auth: authenticateAppUser(['society_resident']): confirmed (routes file line 15)
  - validator fields (invoiceId, amount, paymentDate, paymentMode, referenceNo, bankName, notes): all confirmed against createPaymentValidator lines 37-63
  - controller at line 52, service at line 31, repository at line 59: all confirmed
  - DB tables accounts_payments, accounts_payment_allocations, accounts_invoices: confirmed by SQL in repository
  - accounts_ledger_entries: confirmed by @Entity decorator in ledgerentry.entity.ts
  - double-entry debit/credit logic (Cash/Bank debit, Maintenance Receivable credit): confirmed in repository lines 154-206
  - paymentNo format RES-PAY-{date}-{base36}: confirmed (repository lines 38-41)
  - payment status = PENDING: confirmed (repository SQL line 115)
  - response returns paymentId, paymentNo, amount, status, invoiceStatus, allocatedAmount: confirmed (repository lines 210-217)
  - invoiceStatus logic PAID vs PARTIALLY_PAID: confirmed (repository lines 143-144)
