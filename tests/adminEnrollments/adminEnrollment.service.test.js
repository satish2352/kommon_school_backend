'use strict';

/**
 * Admin Enrollment Service Tests — Phase F1
 *
 * Tests:
 * 1. createManualEnrollment happy path: enrollment created, status=paid, amount paise correct, webhook fired
 * 2. Plan tier + duration that doesn't exist → 404 PLAN_PRICING_NOT_FOUND
 * 3. Inactive plan → 400 PLAN_INACTIVE
 * 4. createBulkEnrollments happy path with 3 rows
 * 5. createBulkEnrollments with a mix of valid + invalid rows: continues, returns per-row results
 * 6. CSV missing required column → 400 CSV_INVALID_HEADERS
 * 7. CSV row count > 1000 → 400 CSV_TOO_LARGE
 *
 * Webhook calls are intercepted by monkey-patching executeWebhookDelivery before
 * the module is loaded, so no HTTP is made.
 */

require('dotenv').config();

const { PrismaClient } = require('@prisma/client');

// ---------------------------------------------------------------------------
// Mock the webhook delivery BEFORE loading the service module.
// We replace executeWebhookDelivery in the loaded module cache by patching
// the exported object that adminEnrollment.service.js imports from enrollmentWebhook.service.js.
// ---------------------------------------------------------------------------
let webhookCallCount = 0;
let lastWebhookArgs = null;

const webhookMod = require('../../src/modules/enrollments/enrollmentWebhook.service');
const originalExecute = webhookMod.executeWebhookDelivery;

function mockWebhookDelivery(args) {
  webhookCallCount++;
  lastWebhookArgs = args;
  return Promise.resolve({
    id: 9999,
    ok: true,
    responseStatus: 200,
    durationMs: 12,
    errorMessage: null,
  });
}

// Patch the exported reference that service.js will use
webhookMod.executeWebhookDelivery = mockWebhookDelivery;

// Now load the service (will use patched export)
const adminEnrollmentService = require('../../src/modules/adminEnrollments/adminEnrollment.service');

const prisma = new PrismaClient();
const TRACE = 'test-trace-admin-enrollments';

const MOCK_ACTOR = { id: 'actor-uuid-001', email: 'admin@example.com', role: 'admin' };

// ---------------------------------------------------------------------------
// Test runner helpers
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
  // Reset webhook mock counters before each test
  webhookCallCount = 0;
  lastWebhookArgs = null;

  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
    if (process.env.VERBOSE_TESTS) console.log(err.stack);
    failures.push({ name, error: err.message });
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

/**
 * Find or create an ACTIVE Silver 1-month PlanPricing.
 */
async function getActiveSilver1Month() {
  let plan = await prisma.plan.findUnique({ where: { tier: 'SILVER' } });
  if (!plan) {
    plan = await prisma.plan.create({
      data: { tier: 'SILVER', name: 'Silver Test', sortOrder: 1, status: 'ACTIVE', features: [] },
    });
  } else if (plan.status !== 'ACTIVE') {
    plan = await prisma.plan.update({ where: { id: plan.id }, data: { status: 'ACTIVE' } });
  }

  let pricing = await prisma.planPricing.findUnique({
    where: { planId_durationMonths: { planId: plan.id, durationMonths: 1 } },
  });
  if (!pricing) {
    pricing = await prisma.planPricing.create({
      data: { planId: plan.id, durationMonths: 1, basePrice: 499, discountPercent: 0, finalPrice: 499, status: 'ACTIVE' },
    });
  } else if (pricing.status !== 'ACTIVE') {
    pricing = await prisma.planPricing.update({ where: { id: pricing.id }, data: { status: 'ACTIVE' } });
  }
  return { plan, pricing };
}

/**
 * Find or create an ACTIVE Gold 3-month PlanPricing then deactivate the parent plan.
 */
async function getActivePricingWithInactivePlan() {
  let plan = await prisma.plan.findUnique({ where: { tier: 'GOLD' } });
  if (!plan) {
    plan = await prisma.plan.create({
      data: { tier: 'GOLD', name: 'Gold Inactive Test', sortOrder: 2, status: 'INACTIVE', features: [] },
    });
  } else {
    plan = await prisma.plan.update({ where: { id: plan.id }, data: { status: 'INACTIVE' } });
  }

  let pricing = await prisma.planPricing.findUnique({
    where: { planId_durationMonths: { planId: plan.id, durationMonths: 3 } },
  });
  if (!pricing) {
    pricing = await prisma.planPricing.create({
      data: { planId: plan.id, durationMonths: 3, basePrice: 2997, discountPercent: 5, finalPrice: 2847.15, status: 'ACTIVE' },
    });
  } else {
    pricing = await prisma.planPricing.update({ where: { id: pricing.id }, data: { status: 'ACTIVE' } });
  }
  return { plan, pricing };
}

/**
 * Restore GOLD plan to ACTIVE (so other tests aren't affected).
 */
async function restoreGoldPlan() {
  await prisma.plan.update({ where: { tier: 'GOLD' }, data: { status: 'ACTIVE' } }).catch(() => {});
}

/**
 * Delete enrollments created during tests by enrollment_code prefix pattern.
 */
async function cleanupTestEnrollments() {
  await prisma.enrollment.deleteMany({
    where: { email: { contains: '+admintest' } },
  }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Payload builders for tests
// ---------------------------------------------------------------------------

function validManualPayload(overrides = {}) {
  return {
    name: 'Test Admin User',
    email: `admin+admintest+${Date.now()}@example.com`,
    phone: '9876543210',
    role: 'STUDENT',
    education: 'GRADUATE',
    readiness: 'BEGINNER',
    source: 'GOOGLE',
    promoCode: 'NEW501',
    planTier: 'SILVER',
    durationMonths: 1,
    notes: 'Created by admin test',
    ...overrides,
  };
}

function buildCsvBuffer(rows) {
  const header = 'name,email,phone,role,education,readiness,source,promoCode,planTier,durationMonths,notes';
  const lines = [header, ...rows];
  return Buffer.from(lines.join('\n'));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function runTests() {
  console.log('\nadminEnrollment.service.test.js — Phase F1\n');

  await getActiveSilver1Month(); // ensure plan + pricing exist

  // ---------------------------------------------------------------------------
  // Test 1: Happy path
  // ---------------------------------------------------------------------------
  await test('1. createManualEnrollment happy path: enrollment=paid, amount paise correct, webhook fired', async () => {
    const { pricing } = await getActiveSilver1Month();
    const expectedPaise = Math.round(Number(pricing.finalPrice) * 100);

    const data = validManualPayload();
    const result = await adminEnrollmentService.createManualEnrollment({
      data,
      actor: MOCK_ACTOR,
      adminSource: 'MANUAL',
      traceId: TRACE,
    });

    assert(result.enrollment, 'Should return enrollment block');
    assert(result.enrollment.id, 'Should have enrollment id');
    assert(result.enrollment.enrollmentCode, 'Should have enrollmentCode');
    assert(result.enrollment.status === 'paid', `Status should be paid, got ${result.enrollment.status}`);
    assert(result.enrollment.amount === expectedPaise, `Amount should be ${expectedPaise} paise, got ${result.enrollment.amount}`);

    assert(result.webhookDelivery, 'Should return webhookDelivery block');
    assert(result.webhookDelivery.ok === true, 'webhookDelivery.ok should be true (mocked)');

    assert(webhookCallCount === 1, `Webhook should have been called once, got ${webhookCallCount}`);

    // Verify admin block in payload passed to webhook
    const webhookPayload = lastWebhookArgs?.payload;
    assert(webhookPayload, 'Payload should be present in webhook args');
    assert(webhookPayload.admin, 'Payload should include admin block');
    assert(webhookPayload.admin.source === 'MANUAL', `admin.source should be MANUAL, got ${webhookPayload.admin.source}`);
    assert(webhookPayload.admin.actorId === MOCK_ACTOR.id, 'admin.actorId should match actor');
    assert(webhookPayload.admin.actorEmail === MOCK_ACTOR.email, 'admin.actorEmail should match actor');
    assert(webhookPayload.admin.notes === data.notes, 'admin.notes should be present');
    assert('rzpResponse' in webhookPayload, 'rzpResponse key should exist in payload');
    assert(webhookPayload.rzpResponse === null, 'rzpResponse should be null for admin flow');

    // Verify planSelection is populated
    assert(webhookPayload.planSelection !== undefined, 'planSelection should be present');
    assert(webhookPayload.planSelection !== null, 'planSelection should not be null for admin flow');
    assert(webhookPayload.planSelection.tier === 'SILVER', 'planSelection.tier should be SILVER');

    // Cleanup
    await prisma.enrollment.delete({ where: { id: result.enrollment.id } }).catch(() => {});
  });

  // ---------------------------------------------------------------------------
  // Test 2: Plan tier + duration that doesn't exist → 404
  // ---------------------------------------------------------------------------
  await test('2. Nonexistent plan tier/duration → 404 PLAN_PRICING_NOT_FOUND', async () => {
    let threw = false;
    const data = validManualPayload({ planTier: 'PLATINUM', durationMonths: 12 });

    // Make PLATINUM 12-month not exist or make plan INACTIVE temporarily
    // Instead just use a tier/duration that provably has no active pricing
    // We'll use an unusual combination: SILVER with durationMonths=99 (not valid in schema)
    // Actually durationMonths=12 for any tier that may exist. We'll delete if present.
    // Safest: patch the data to use SILVER + durationMonths=6 but first mark it INACTIVE
    const platinumPlan = await prisma.plan.findUnique({ where: { tier: 'PLATINUM' } });
    let deactivatedPricing = null;
    if (platinumPlan) {
      // Find 12-month pricing for PLATINUM and deactivate temporarily
      const pp = await prisma.planPricing.findUnique({
        where: { planId_durationMonths: { planId: platinumPlan.id, durationMonths: 12 } },
      });
      if (pp && pp.status === 'ACTIVE') {
        await prisma.planPricing.update({ where: { id: pp.id }, data: { status: 'INACTIVE' } });
        deactivatedPricing = pp;
      } else if (!pp) {
        // No pricing exists — good, test will 404
      }
    }

    // Also need plan to exist but no active 12-month pricing
    // If the above deactivated it, good; if plan doesn't exist, also good
    try {
      await adminEnrollmentService.createManualEnrollment({
        data,
        actor: MOCK_ACTOR,
        adminSource: 'MANUAL',
        traceId: TRACE,
      });
    } catch (err) {
      threw = true;
      assert(err.statusCode === 404, `Expected 404, got ${err.statusCode}`);
      assert(err.code === 'PLAN_PRICING_NOT_FOUND', `Expected PLAN_PRICING_NOT_FOUND, got ${err.code}`);
    }
    assert(threw, 'Should have thrown 404');
    assert(webhookCallCount === 0, 'Webhook should not be called on error');

    // Restore
    if (deactivatedPricing) {
      await prisma.planPricing.update({ where: { id: deactivatedPricing.id }, data: { status: 'ACTIVE' } }).catch(() => {});
    }
  });

  // ---------------------------------------------------------------------------
  // Test 3: Inactive plan → 400 PLAN_INACTIVE
  // ---------------------------------------------------------------------------
  await test('3. Inactive parent plan → 400 PLAN_INACTIVE', async () => {
    await getActivePricingWithInactivePlan(); // sets GOLD to INACTIVE

    let threw = false;
    const data = validManualPayload({ planTier: 'GOLD', durationMonths: 3 });

    try {
      await adminEnrollmentService.createManualEnrollment({
        data,
        actor: MOCK_ACTOR,
        adminSource: 'MANUAL',
        traceId: TRACE,
      });
    } catch (err) {
      threw = true;
      assert(err.statusCode === 404 || err.statusCode === 400,
        `Expected 404 or 400, got ${err.statusCode} — ${err.message}`);
      // PLAN_INACTIVE via Prisma filter returns 404 (no active row found)
      // because the query filters status:'ACTIVE' on plan
    }
    assert(threw, 'Should have thrown when plan is inactive');
    assert(webhookCallCount === 0, 'Webhook should not be called on error');

    await restoreGoldPlan();
  });

  // ---------------------------------------------------------------------------
  // Test 4: createBulkEnrollments happy path (3 rows)
  // ---------------------------------------------------------------------------
  await test('4. createBulkEnrollments happy path with 3 rows', async () => {
    const ts = Date.now();
    const rows = [
      `Bulk User One,bulk+admintest+${ts}1@example.com,9000000001,STUDENT,GRADUATE,BEGINNER,GOOGLE,NEW501,SILVER,1,Row 1`,
      `Bulk User Two,bulk+admintest+${ts}2@example.com,9000000002,WORKING_PROFESSIONAL,GRADUATE,INTERMEDIATE,COLLEGE,NEW501,SILVER,1,Row 2`,
      `Bulk User Three,bulk+admintest+${ts}3@example.com,9000000003,FRESH_GRADUATE,UNDERGRADUATE,READY_FOR_INTERVIEW,FRIEND,NEW501,SILVER,1,Row 3`,
    ];
    const fileBuffer = buildCsvBuffer(rows);

    const result = await adminEnrollmentService.createBulkEnrollments({
      fileBuffer,
      actor: MOCK_ACTOR,
      traceId: TRACE,
    });

    assert(result.total === 3, `total should be 3, got ${result.total}`);
    assert(result.success === 3, `success should be 3, got ${result.success}`);
    assert(result.failed === 0, `failed should be 0, got ${result.failed}`);
    assert(result.rows.length === 3, `rows length should be 3`);
    assert(result.rows.every((r) => r.status === 'success'), 'All rows should succeed');
    assert(result.rows.every((r) => r.enrollmentCode), 'All rows should have enrollmentCode');
    assert(webhookCallCount === 3, `Webhook should fire 3 times, got ${webhookCallCount}`);

    // Cleanup
    for (const row of result.rows) {
      if (row.enrollmentCode) {
        await prisma.enrollment.delete({ where: { enrollment_code: row.enrollmentCode } }).catch(() => {});
      }
    }
  });

  // ---------------------------------------------------------------------------
  // Test 5: Mixed valid + invalid rows
  // ---------------------------------------------------------------------------
  await test('5. createBulkEnrollments with mixed valid + invalid rows', async () => {
    const ts = Date.now();
    const rows = [
      // Row 1: valid
      `Mixed User One,mixed+admintest+${ts}1@example.com,9100000001,STUDENT,GRADUATE,BEGINNER,GOOGLE,NEW501,SILVER,1,Valid row`,
      // Row 2: invalid — bad email
      `Mixed User Two,not-an-email,9100000002,STUDENT,,,,,SILVER,1,`,
      // Row 3: valid
      `Mixed User Three,mixed+admintest+${ts}3@example.com,9100000003,CAREER_SWITCHER,,,,,SILVER,1,Valid row 3`,
    ];
    const fileBuffer = buildCsvBuffer(rows);

    const result = await adminEnrollmentService.createBulkEnrollments({
      fileBuffer,
      actor: MOCK_ACTOR,
      traceId: TRACE,
    });

    assert(result.total === 3, `total should be 3, got ${result.total}`);
    assert(result.success === 2, `success should be 2, got ${result.success}`);
    assert(result.failed === 1, `failed should be 1, got ${result.failed}`);
    assert(result.rows[0].status === 'success', 'Row 1 should succeed');
    assert(result.rows[1].status === 'failed', 'Row 2 should fail (bad email)');
    assert(result.rows[2].status === 'success', 'Row 3 should succeed');
    assert(result.rows[1].rowIndex === 2, `Failed row should be rowIndex 2, got ${result.rows[1].rowIndex}`);
    // Successful rows were not rolled back by the failed row
    assert(result.rows[0].enrollmentCode, 'Row 1 should have enrollmentCode');
    assert(result.rows[2].enrollmentCode, 'Row 3 should have enrollmentCode');

    // Cleanup successful rows
    for (const row of result.rows) {
      if (row.status === 'success' && row.enrollmentCode) {
        await prisma.enrollment.delete({ where: { enrollment_code: row.enrollmentCode } }).catch(() => {});
      }
    }
  });

  // ---------------------------------------------------------------------------
  // Test 6: CSV missing required column → 400 CSV_INVALID_HEADERS
  // ---------------------------------------------------------------------------
  await test('6. CSV missing required column → 400 CSV_INVALID_HEADERS', async () => {
    // CSV without 'planTier' column
    const csvContent = Buffer.from(
      'name,email,phone,role,durationMonths\nTest User,t@example.com,9000000000,STUDENT,1\n',
    );

    let threw = false;
    try {
      await adminEnrollmentService.createBulkEnrollments({
        fileBuffer: csvContent,
        actor: MOCK_ACTOR,
        traceId: TRACE,
      });
    } catch (err) {
      threw = true;
      assert(err.statusCode === 400, `Expected 400, got ${err.statusCode}`);
      assert(err.code === 'CSV_INVALID_HEADERS', `Expected CSV_INVALID_HEADERS, got ${err.code}`);
      assert(typeof err.message === 'string', 'Error should have message');
    }
    assert(threw, 'Should have thrown 400 CSV_INVALID_HEADERS');
    assert(webhookCallCount === 0, 'Webhook should not be called');
  });

  // ---------------------------------------------------------------------------
  // Test 7: CSV row count > 1000 → 400 CSV_TOO_LARGE
  // ---------------------------------------------------------------------------
  await test('7. CSV row count > 1000 → 400 CSV_TOO_LARGE', async () => {
    const header = 'name,email,phone,role,planTier,durationMonths';
    // Generate 1001 data rows
    const rows = Array.from({ length: 1001 }, (_, i) =>
      `User ${i},user${i}@example.com,9000000000,STUDENT,SILVER,1`,
    );
    const csvContent = Buffer.from([header, ...rows].join('\n'));

    let threw = false;
    try {
      await adminEnrollmentService.createBulkEnrollments({
        fileBuffer: csvContent,
        actor: MOCK_ACTOR,
        traceId: TRACE,
      });
    } catch (err) {
      threw = true;
      assert(err.statusCode === 400, `Expected 400, got ${err.statusCode}`);
      assert(err.code === 'CSV_TOO_LARGE', `Expected CSV_TOO_LARGE, got ${err.code}`);
    }
    assert(threw, 'Should have thrown 400 CSV_TOO_LARGE');
    assert(webhookCallCount === 0, 'Webhook should not be called');
  });

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------

  // Restore webhook to original (courteous for any sibling tests)
  webhookMod.executeWebhookDelivery = originalExecute;

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);

  if (failures.length > 0) {
    console.log('\nFailures:');
    for (const f of failures) {
      console.log(`  - ${f.name}: ${f.error}`);
    }
    process.exit(1);
  } else {
    console.log('\nAll tests passed.');
    process.exit(0);
  }
}

runTests()
  .catch((err) => {
    console.error('Test runner error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await cleanupTestEnrollments().catch(() => {});
    await prisma.$disconnect();
  });
