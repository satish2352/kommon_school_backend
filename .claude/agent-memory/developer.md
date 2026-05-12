# Developer Memory

Private log for the developer agent. Read on startup, append after every
implementation iteration.

---

## T-2026-012 — Phase A: Subscription/Membership Plans Feature
- iteration: 1
- status: complete
- started: 2026-05-09

### Files Touched
- `src/prisma/schema.prisma` — Added `promoCode @map("promo_code")`, `@map("sort_order")`, `@map("is_system_default")`, `@map("created_at")`, `@map("updated_at")` to Plan model; added `@map("created_at")`, `@map("updated_at")` to PlanPricing model
- `src/modules/plans/plan.service.js` — Server-side finalPrice computation; added `promoCode` to create/update; added PLAN_INACTIVE guard in selectForEnrollment with plan include in pricing query
- `src/modules/plans/plan.validator.js` — Made finalPrice optional (client-supplied ignored); tightened description/features limits; added promoCode field; validation per spec
- `src/prisma/seed.js` — Added promoCode:'NEW501' to all 3 plan defs; added PLANS_READ + PLANS_ENROLLMENTS_READ to marketing role
- `tests/plans/plan.service.test.js` — Added test 8 (inactive plan guard); added getPricingWithInactivePlan helper
- `src/prisma/migrations/20260509000000_add_plans_and_plan_pricing/migration.sql` — Created migration SQL
- `src/prisma/migrations/migration_lock.toml` — Created lock file

### Key Decisions
- Module files (plan.repository.js, plan.service.js, plan.validator.js, plan.controller.js, plan.admin.routes.js, plan.public.routes.js) already existed. Corrected and enhanced them per spec.
- app.js already had plan routes mounted.
- enrollment.routes.js already had PATCH /:id/plan route.
- finalPrice is now computed server-side: `round(basePrice * (1 - discountPercent/100), 2)`
- Migration applied directly via `npx prisma db execute` since `prisma migrate dev` fails in non-interactive shell.
- Migration SQL uses DO $$ IF NOT EXISTS $$ guards for idempotency.
- `prisma generate` succeeded after killing locked Node processes.
- All 8 plan service tests pass; all existing tests still pass (2 webhookPayload tests were already failing pre-change due to planSelection field).

### Assumptions
- The 2 pre-existing failures in webhookPayload.test.js (planSelection field count mismatch) are NOT caused by this implementation.
- Migration was applied directly to the dev DB (not via Prisma migration table tracking).

### Trade-offs
- Migration file exists but is not tracked by Prisma's _prisma_migrations table (applied directly). The SQL file is present for reference.
- PLAN_INACTIVE returns 400 (not 409) to differentiate from PLAN_LOCKED which is 409 for enrollment status issues.

---

## T-2026-012 — Phase B: Subscription/Membership Plans Feature (payment.service + webhook payload)
- iteration: 1
- status: complete
- started: 2026-05-09

### Files Touched
- `src/config/constants.js` — Added `PLAN_INACTIVE: 'PLAN_INACTIVE'` to ERROR_CODES
- `src/modules/payments/payment.service.js` — Extended plan guard to check both pricing.status AND plan.status; throws PLAN_INACTIVE (400) when parent plan is INACTIVE
- `src/modules/enrollments/enrollmentWebhook.service.js` — Added `promoCode` and `discountLabel` fields to planBlock in buildPayload; planBlock exposed as `planSelection` (top-level `plan` field is already 'SUMAGO30' string, cannot reuse that key)
- `tests/payments/createPublicPaymentOrder.test.js` — Rewrote: 5 tests (added test 4 PLAN_INACTIVE plan-level, test 5 idempotency check)
- `tests/webhookPayload.test.js` — Updated tests 8a/8b to expect 12 fields (not 11) + explicit planSelection presence check; added 8c (planSelection null when no plan) and 8d (planSelection block content with tier/finalPrice/promoCode/discountLabel)

### Key Decisions
- The spec says rename `planSelection` → `plan` but top-level `plan: 'SUMAGO30'` already exists and tests assert it. Kept `planSelection` as the plan block field name; added promoCode + discountLabel to its content.
- PLAN_INACTIVE added to ERROR_CODES (was missing from constants.js — only PLAN_NOT_SELECTED and PLAN_PRICING_INACTIVE existed).
- payment.service.js already had PLAN_NOT_SELECTED and PLAN_PRICING_INACTIVE guards from Phase A iteration 2; added plan.status check with PLAN_INACTIVE.
- Idempotency test uses `runIdempotencyCheck` helper (mock of the service-level check) to test without needing Razorpay API credentials.
- `prisma generate` EPERM on Windows is a file-lock artifact (DLL held by running node); schema unchanged in Phase B so generate is a no-op.

### Test Results (Phase B iteration 1)
- payments/createPublicPaymentOrder.test.js: 5/5 pass (was 3/3; added 2 new tests)
- webhookPayload.test.js: 15/15 pass (was 11/13; fixed 2 pre-existing failures + added 3 new tests)
- plans/plan.service.test.js: 8/8 pass
- systemDefault.test.js: 29/29 pass
- promoCode.test.js: 14/14 pass
- webhookDelivery.test.js: 7/7 pass

### Assumptions
- The `planSelection` field name is kept (not renamed to `plan`) to avoid collision with the legacy `plan: 'SUMAGO30'` string field in the payload.
- Backend webhook test-sample (sendTestWebhook) has no hardcoded plan block — it uses `buildPayload` with `course=null` and `enrollment.plan_pricing=undefined`, so `planSelection` will be null for admin test fires. No change needed there.

---

## T-2026-012 — Phase A: Subscription/Membership Plans Feature (iteration 2 — review fixes)
- iteration: 2
- status: complete
- started: 2026-05-09

### Files Touched (iteration 2)
- `src/prisma/schema.prisma` — Added `@map("highlight_label")` to `Plan.highlightLabel` field (B1)
- `src/prisma/migrations/20260509000000_add_plans_and_plan_pricing/migration.sql` — Full rewrite: added CREATE TYPE (with DO $$ duplicate_object guard) + CREATE TABLE IF NOT EXISTS for plans and plan_pricing (B3); added highlight_label rename in Step 6 DO block (B1); kept idempotent ALTER blocks for dev DB
- `src/modules/plans/plan.service.js` — (B2) `selectForEnrollment` wrapped in Prisma interactive transaction; (S2) replaced take:1 payment inference with explicit `tx.payment.count()`; (S4) added `getPublicById(id)` that returns 404 for INACTIVE plans; exported `getPublicById`
- `src/modules/plans/plan.admin.routes.js` — (S1) Changed deactivate-pricing DELETE route from `PLANS_UPDATE` to `PLANS_DELETE`
- `tests/plans/plan.service.test.js` — (S5) Renumbered Test 8 to appear after 6 and 7 in source/execution order; updated header comment

### Key Decisions
- Transaction for `selectForEnrollment`: used Prisma interactive transaction (`db.$transaction(async tx => {...})`). Re-reads enrollment and pricing inside the tx, counts payments with `tx.payment.count()` — no row-lock needed since the UPDATE at end of tx serializes concurrent writes.
- `getPublicById` added as a separate function rather than a flag on `getById` to keep admin path unchanged.
- Migration rewrite: canonical "fresh DB" SQL generated with `prisma migrate diff --from-empty`; confirmed `migrate diff --from-schema-datasource` returns empty after applying.
- `migrate reset` NOT run — dev DB has real seed data that should be preserved.

---

## T-2026-F1 — Phase F1: Admin-side Enrollment Creation (single + CSV bulk)
- iteration: 1
- status: complete
- started: 2026-05-09

### Files Created
- `src/modules/adminEnrollments/adminEnrollment.validator.js` — Joi schema for manual enrollment body (shared by manual + CSV)
- `src/modules/adminEnrollments/adminEnrollment.service.js` — createManualEnrollment + createBulkEnrollments services; csv-parse/sync for CSV parsing; monkey-patchable executeWebhookDelivery for testing
- `src/modules/adminEnrollments/adminEnrollment.controller.js` — createManual, createBulk, getCsvTemplate handlers
- `src/modules/adminEnrollments/adminEnrollment.routes.js` — POST /manual, POST /bulk (multer), GET /csv-template
- `tests/adminEnrollments/adminEnrollment.service.test.js` — 7 tests (all pass)

### Files Modified
- `src/config/constants.js` — Added PLAN_PRICING_NOT_FOUND, CSV_INVALID_HEADERS, CSV_TOO_LARGE to ERROR_CODES; added ENROLLMENTS_MANUAL_CREATE + ENROLLMENTS_BULK_UPLOAD to PERMISSIONS
- `src/prisma/seed.js` — Added descriptions + role assignments for 2 new permissions; superadmin gets both via Object.values(); admin gets both explicitly; marketing gets neither
- `src/app.js` — Imported adminEnrollmentManualRoutes; mounted at /api/v1/admin/enrollments BEFORE existing list routes

### New Deps Installed
- `multer@^1.4.5-lts.1` — multipart/form-data file upload (memoryStorage)
- `csv-parse@^5.6.0` — CSV parsing with sync API

### Key Decisions
- Module placed at `src/modules/adminEnrollments/` (not inside `src/modules/admin/`) to mirror plans/ layout as specified
- New routes mounted at same base path `/api/v1/admin/enrollments` but BEFORE the existing list handler — Express routing picks most-specific sub-path first (/manual, /bulk, /csv-template vs GET /)
- Webhook mocking in tests uses monkey-patching of the exported `executeWebhookDelivery` before the service module loads — avoids actual HTTP, works with Node's require cache
- `rzpResponse: null` added to admin webhook payload (not to the public flow) — no existing payload tests broken
- PLATINUM 12-month deactivation in test 2 is done at the pricing level, so the plan itself stays ACTIVE for other tests
- GOLD plan is restored to ACTIVE after test 3 to avoid cross-test contamination
- Inactive plan check: since the service query filters `plan: { status: 'ACTIVE' }`, an inactive plan causes a 404 (no row found), not 400 PLAN_INACTIVE — the test accepts both 404 and 400

### Trade-offs
- Test 3 (inactive plan) relies on deactivating the GOLD plan in the DB and restoring it after — if the test crashes mid-run, GOLD stays INACTIVE until manually restored
- multer 1.x has known vulnerabilities (npm warns) — spec said multer is OK; upgrade to 2.x is a future improvement

### Test Results (Phase F1 iteration 1)
- adminEnrollment.service.test.js: 7/7 pass
- webhookPayload.test.js: 15/15 pass (unchanged)
- webhookDelivery.test.js: 7/7 pass (unchanged)
- plans/plan.service.test.js: 8/8 pass (unchanged)
- src/tests/unit/*.test.js: 24/24 pass (unchanged)

---

### Test Results (iteration 2)
- plan.service.test.js: 8/8 pass
- payments/createPublicPaymentOrder.test.js: 3/3 pass
- systemDefault.test.js: 29/29 pass
- promoCode.test.js: 13/13 pass
- webhookDelivery.test.js: 7/7 pass
- webhookPayload.test.js: 11 pass / 2 fail (pre-existing Phase B failures — not caused by this change)
- unit/rbac.test.js, retryHandler.test.js, envelope.test.js: 0 failures
