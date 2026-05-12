'use strict';

/**
 * T-2026-KOMMON-017: Plan service selectForEnrollment tests
 *
 * Tests (in source/execution order):
 * 1. Happy path: enrollment status='submitted', ACTIVE pricing → succeeds
 * 2. Status guard: enrollment status='paid' → throws 409
 * 3. Idempotent re-select: status='payment_pending' AND no Payment rows → succeeds
 * 4. Blocked re-select: status='payment_pending' AND has Payment rows → throws 409
 * 5. Inactive pricing guard → throws 400 with code PLAN_PRICING_INACTIVE
 * 6. Nonexistent enrollmentId → throws 404
 * 7. Nonexistent planPricingId → throws 404
 * 8. Inactive parent plan guard → throws 400 with code PLAN_INACTIVE
 */

require('dotenv').config();

const { PrismaClient } = require('@prisma/client');
const planService = require('../../src/modules/plans/plan.service');

const prisma = new PrismaClient();
const TRACE = 'test-trace-plans';

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
    failures.push({ name, error: err.message });
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

// ---------------------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------------------

/**
 * Create a minimal enrollment row directly in the DB for testing.
 * Returns the created enrollment (with payments: []).
 */
async function createTestEnrollment({ status = 'submitted', planPricingId = null } = {}) {
  const code = `TEST-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  return prisma.enrollment.create({
    data: {
      email:           `test+${code}@example.com`,
      phone_number:    '9999999999',
      name:            'Test User',
      first_name:      'Test',
      last_name:       'User',
      enrollment_code: code,
      status,
      plan_pricing_id: planPricingId,
    },
  });
}

/**
 * Find or create a Silver 1-month ACTIVE PlanPricing for testing.
 */
async function getActivePricing() {
  // Find the Silver plan
  let plan = await prisma.plan.findUnique({ where: { tier: 'SILVER' } });
  if (!plan) {
    plan = await prisma.plan.create({
      data: {
        tier:     'SILVER',
        name:     'Silver Test',
        sortOrder: 1,
        status:   'ACTIVE',
        features: [],
      },
    });
  }

  // Find or create the 1-month pricing
  let pricing = await prisma.planPricing.findUnique({
    where: { planId_durationMonths: { planId: plan.id, durationMonths: 1 } },
  });
  if (!pricing) {
    pricing = await prisma.planPricing.create({
      data: {
        planId:          plan.id,
        durationMonths:  1,
        basePrice:       499,
        discountPercent: 0,
        finalPrice:      499,
        status:          'ACTIVE',
      },
    });
  } else if (pricing.status !== 'ACTIVE') {
    pricing = await prisma.planPricing.update({
      where: { id: pricing.id },
      data:  { status: 'ACTIVE' },
    });
  }

  return pricing;
}

/**
 * Create an INACTIVE PlanPricing for testing the inactive guard.
 */
async function getInactivePricing() {
  let plan = await prisma.plan.findUnique({ where: { tier: 'GOLD' } });
  if (!plan) {
    plan = await prisma.plan.create({
      data: {
        tier:     'GOLD',
        name:     'Gold Test',
        sortOrder: 2,
        status:   'ACTIVE',
        features: [],
      },
    });
  }

  // Use durationMonths=3 as the inactive test row
  let pricing = await prisma.planPricing.findUnique({
    where: { planId_durationMonths: { planId: plan.id, durationMonths: 3 } },
  });
  if (!pricing) {
    pricing = await prisma.planPricing.create({
      data: {
        planId:          plan.id,
        durationMonths:  3,
        basePrice:       2997,
        discountPercent: 5,
        finalPrice:      2847.15,
        status:          'INACTIVE',
      },
    });
  } else {
    pricing = await prisma.planPricing.update({
      where: { id: pricing.id },
      data:  { status: 'INACTIVE' },
    });
  }

  return pricing;
}

/**
 * Create an ACTIVE PlanPricing whose parent Plan is INACTIVE.
 * Uses PLATINUM tier (durationMonths=6) as the test slot.
 */
async function getPricingWithInactivePlan() {
  let plan = await prisma.plan.findUnique({ where: { tier: 'PLATINUM' } });
  if (!plan) {
    plan = await prisma.plan.create({
      data: {
        tier:      'PLATINUM',
        name:      'Platinum Test',
        sortOrder: 3,
        status:    'INACTIVE',
        features:  [],
      },
    });
  } else if (plan.status !== 'INACTIVE') {
    plan = await prisma.plan.update({
      where: { tier: 'PLATINUM' },
      data:  { status: 'INACTIVE' },
    });
  }

  let pricing = await prisma.planPricing.findUnique({
    where: { planId_durationMonths: { planId: plan.id, durationMonths: 6 } },
  });
  if (!pricing) {
    pricing = await prisma.planPricing.create({
      data: {
        planId:          plan.id,
        durationMonths:  6,
        basePrice:       11994,
        discountPercent: 10,
        finalPrice:      10794.60,
        status:          'ACTIVE',
      },
    });
  } else {
    pricing = await prisma.planPricing.update({
      where: { id: pricing.id },
      data:  { status: 'ACTIVE' },
    });
  }

  return { plan, pricing };
}

/**
 * Clean up test enrollments created during this test run.
 */
async function cleanupEnrollment(id) {
  try {
    await prisma.enrollment.delete({ where: { id } });
  } catch (_) {
    // best-effort
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function runTests() {
  console.log('\nplan.service.test.js — selectForEnrollment\n');

  const activePricing  = await getActivePricing();
  const inactivePricing = await getInactivePricing();
  const { pricing: pricingWithInactivePlan } = await getPricingWithInactivePlan();

  // --- Test 1: Happy path (submitted → payment_pending) ---
  await test('1. Happy path: submitted + ACTIVE pricing → succeeds', async () => {
    const enrollment = await createTestEnrollment({ status: 'submitted' });
    try {
      const result = await planService.selectForEnrollment(enrollment.id, activePricing.id, TRACE);
      assert(result.enrollment, 'Should return enrollment');
      assert(result.planPricing, 'Should return planPricing');
      assert(result.enrollment.status === 'payment_pending', 'Status should be payment_pending');
      assert(result.enrollment.plan_pricing_id === activePricing.id, 'plan_pricing_id should be set');
      const expectedPaise = Math.round(Number(activePricing.finalPrice) * 100);
      assert(result.enrollment.amount === expectedPaise, `Amount should be ${expectedPaise} paise`);
    } finally {
      await cleanupEnrollment(enrollment.id);
    }
  });

  // --- Test 2: Status guard — paid enrollment ---
  await test('2. Status guard: enrollment status=paid → throws 409', async () => {
    const enrollment = await createTestEnrollment({ status: 'paid' });
    try {
      let threw = false;
      try {
        await planService.selectForEnrollment(enrollment.id, activePricing.id, TRACE);
      } catch (err) {
        threw = true;
        assert(err.statusCode === 409, `Expected 409, got ${err.statusCode}`);
      }
      assert(threw, 'Should have thrown');
    } finally {
      await cleanupEnrollment(enrollment.id);
    }
  });

  // --- Test 3: Idempotent re-select (payment_pending, no Payment rows) ---
  await test('3. Idempotent re-select: payment_pending + no Payment rows → succeeds', async () => {
    const enrollment = await createTestEnrollment({ status: 'payment_pending' });
    try {
      const result = await planService.selectForEnrollment(enrollment.id, activePricing.id, TRACE);
      assert(result.enrollment.status === 'payment_pending', 'Status should remain payment_pending');
      assert(result.enrollment.plan_pricing_id === activePricing.id, 'plan_pricing_id should be set');
    } finally {
      await cleanupEnrollment(enrollment.id);
    }
  });

  // --- Test 4: Blocked re-select (payment_pending, has Payment rows) ---
  await test('4. Blocked re-select: payment_pending + existing Payment rows → throws 409', async () => {
    const enrollment = await createTestEnrollment({ status: 'payment_pending' });
    // Create a payment row for this enrollment
    let paymentId = null;
    try {
      const payment = await prisma.payment.create({
        data: {
          enrollment_id:    enrollment.id,
          razorpay_order_id: `order_test_${Date.now()}`,
          amount:            49900,
          currency:          'INR',
          status:            'initiated',
        },
      });
      paymentId = payment.id;

      let threw = false;
      try {
        await planService.selectForEnrollment(enrollment.id, activePricing.id, TRACE);
      } catch (err) {
        threw = true;
        assert(err.statusCode === 409, `Expected 409, got ${err.statusCode}`);
      }
      assert(threw, 'Should have thrown');
    } finally {
      if (paymentId) await prisma.payment.delete({ where: { id: paymentId } }).catch(() => {});
      await cleanupEnrollment(enrollment.id);
    }
  });

  // --- Test 5: Inactive pricing guard ---
  await test('5. Inactive pricing guard → throws 400 with code PLAN_PRICING_INACTIVE', async () => {
    const enrollment = await createTestEnrollment({ status: 'submitted' });
    try {
      let threw = false;
      try {
        await planService.selectForEnrollment(enrollment.id, inactivePricing.id, TRACE);
      } catch (err) {
        threw = true;
        assert(err.statusCode === 400, `Expected 400, got ${err.statusCode}`);
        assert(err.code === 'PLAN_PRICING_INACTIVE', `Expected PLAN_PRICING_INACTIVE, got ${err.code}`);
      }
      assert(threw, 'Should have thrown');
    } finally {
      await cleanupEnrollment(enrollment.id);
    }
  });

  // --- Test 6: Nonexistent enrollment ---
  await test('6. Nonexistent enrollmentId → throws 404', async () => {
    const fakeId = '00000000-0000-4000-8000-000000000000';
    let threw = false;
    try {
      await planService.selectForEnrollment(fakeId, activePricing.id, TRACE);
    } catch (err) {
      threw = true;
      assert(err.statusCode === 404, `Expected 404, got ${err.statusCode}`);
    }
    assert(threw, 'Should have thrown 404');
  });

  // --- Test 7: Nonexistent planPricingId ---
  await test('7. Nonexistent planPricingId → throws 404', async () => {
    const enrollment = await createTestEnrollment({ status: 'submitted' });
    try {
      let threw = false;
      try {
        await planService.selectForEnrollment(enrollment.id, 999999, TRACE);
      } catch (err) {
        threw = true;
        assert(err.statusCode === 404, `Expected 404, got ${err.statusCode}`);
      }
      assert(threw, 'Should have thrown 404');
    } finally {
      await cleanupEnrollment(enrollment.id);
    }
  });

  // --- Test 8: Inactive parent plan guard ---
  await test('8. Inactive plan guard → throws 400 with code PLAN_INACTIVE', async () => {
    const enrollment = await createTestEnrollment({ status: 'submitted' });
    try {
      let threw = false;
      try {
        await planService.selectForEnrollment(enrollment.id, pricingWithInactivePlan.id, TRACE);
      } catch (err) {
        threw = true;
        assert(err.statusCode === 400, `Expected 400, got ${err.statusCode}`);
        assert(err.code === 'PLAN_INACTIVE', `Expected PLAN_INACTIVE, got ${err.code}`);
      }
      assert(threw, 'Should have thrown');
    } finally {
      await cleanupEnrollment(enrollment.id);
      // Restore PLATINUM plan to ACTIVE so it does not affect subsequent seed runs
      await prisma.plan.update({
        where: { tier: 'PLATINUM' },
        data:  { status: 'ACTIVE' },
      }).catch(() => {});
    }
  });

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------

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
    await prisma.$disconnect();
  });
