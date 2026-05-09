# Code Reviewer Memory

Private log for the code_reviewer agent. Read on startup, append after every
review.

---

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
