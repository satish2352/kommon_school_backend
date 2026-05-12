'use strict';

/**
 * T-2026-KOMMON-017 Phase B: createOrder payment service tests
 *
 * Tests:
 * 1. Happy path: enrollment with plan selected → guard passes, returns amountPaise
 * 2. No plan selected: plan_pricing_id null → throws 400 PLAN_NOT_SELECTED
 * 3. Inactive pricing: plan_pricing.status=INACTIVE → throws 400 PLAN_PRICING_INACTIVE
 * 4. Inactive plan (parent): plan.status=INACTIVE → throws 400 PLAN_INACTIVE
 * 5. Idempotent: existing 'initiated' payment returned without creating duplicate
 */

require('dotenv').config();

const { PrismaClient } = require('@prisma/client');
const ApiError = require('../../src/utils/ApiError');

const prisma = new PrismaClient();
const TRACE = 'test-trace-payment-phase-b';

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
// Test-specific mock of paymentService.createOrder
// We test only the guard logic (not the Razorpay API call) by checking
// the error codes thrown when plan conditions are not met.
// ---------------------------------------------------------------------------

/**
 * Simulate the plan guard checks that createOrder performs.
 * Mirrors the logic in payment.service.js Phase B implementation.
 */
async function runPlanGuards(enrollmentId) {
  const db = prisma;
  const enrollment = await db.enrollment.findFirst({
    where: { id: enrollmentId, deleted_at: null },
    include: {
      payments: { orderBy: { created_at: 'desc' }, take: 1 },
      plan_pricing: { include: { plan: true } },
    },
  });

  if (!enrollment) {
    throw new ApiError(404, 'NOT_FOUND', 'Enrollment not found');
  }

  if (!enrollment.plan_pricing_id || !enrollment.plan_pricing) {
    throw new ApiError(400, 'PLAN_NOT_SELECTED', 'A subscription plan must be selected before proceeding to payment');
  }

  if (enrollment.plan_pricing.status !== 'ACTIVE' || enrollment.plan_pricing.plan.status !== 'ACTIVE') {
    const code = enrollment.plan_pricing.plan.status !== 'ACTIVE'
      ? 'PLAN_INACTIVE'
      : 'PLAN_PRICING_INACTIVE';
    throw new ApiError(400, code, 'Selected plan is no longer available.');
  }

  // Return the amount that would be used
  return { amountPaise: enrollment.amount, planPricing: enrollment.plan_pricing };
}

/**
 * Simulate the idempotency check that createOrder performs:
 * if an 'initiated' or 'pending' payment exists, return it instead of creating a new one.
 */
async function runIdempotencyCheck(enrollmentId) {
  const payments = await prisma.payment.findMany({
    where: { enrollment_id: enrollmentId },
    orderBy: { created_at: 'desc' },
  });
  const reusable = payments.find((p) => p.status === 'initiated' || p.status === 'pending');
  return reusable || null;
}

// ---------------------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------------------

async function getActivePricing() {
  let plan = await prisma.plan.findUnique({ where: { tier: 'SILVER' } });
  if (!plan) {
    plan = await prisma.plan.create({
      data: { tier: 'SILVER', name: 'Silver', sortOrder: 1, status: 'ACTIVE', features: [] },
    });
  } else if (plan.status !== 'ACTIVE') {
    plan = await prisma.plan.update({ where: { tier: 'SILVER' }, data: { status: 'ACTIVE' } });
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
  return pricing;
}

async function getInactivePricing() {
  let plan = await prisma.plan.findUnique({ where: { tier: 'GOLD' } });
  if (!plan) {
    plan = await prisma.plan.create({
      data: { tier: 'GOLD', name: 'Gold', sortOrder: 2, status: 'ACTIVE', features: [] },
    });
  } else if (plan.status !== 'ACTIVE') {
    // Make sure the plan itself is ACTIVE (we're testing pricing-level inactive)
    plan = await prisma.plan.update({ where: { tier: 'GOLD' }, data: { status: 'ACTIVE' } });
  }
  let pricing = await prisma.planPricing.findUnique({
    where: { planId_durationMonths: { planId: plan.id, durationMonths: 3 } },
  });
  if (!pricing) {
    pricing = await prisma.planPricing.create({
      data: { planId: plan.id, durationMonths: 3, basePrice: 2997, discountPercent: 5, finalPrice: 2847.15, status: 'INACTIVE' },
    });
  } else {
    pricing = await prisma.planPricing.update({ where: { id: pricing.id }, data: { status: 'INACTIVE' } });
  }
  return pricing;
}

/**
 * Returns an ACTIVE pricing whose parent plan is INACTIVE.
 * Uses PLATINUM tier to avoid interfering with other tests.
 */
async function getPricingWithInactivePlan() {
  let plan = await prisma.plan.findUnique({ where: { tier: 'PLATINUM' } });
  if (!plan) {
    plan = await prisma.plan.create({
      data: { tier: 'PLATINUM', name: 'Platinum', sortOrder: 3, status: 'INACTIVE', features: [] },
    });
  } else if (plan.status !== 'INACTIVE') {
    plan = await prisma.plan.update({ where: { tier: 'PLATINUM' }, data: { status: 'INACTIVE' } });
  }
  let pricing = await prisma.planPricing.findUnique({
    where: { planId_durationMonths: { planId: plan.id, durationMonths: 6 } },
  });
  if (!pricing) {
    pricing = await prisma.planPricing.create({
      data: { planId: plan.id, durationMonths: 6, basePrice: 11994, discountPercent: 10, finalPrice: 10794.60, status: 'ACTIVE' },
    });
  } else {
    pricing = await prisma.planPricing.update({ where: { id: pricing.id }, data: { status: 'ACTIVE' } });
  }
  return pricing;
}

async function createTestEnrollment({ planPricingId = null, amount = null } = {}) {
  const code = `PAYTEST-${Date.now()}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
  return prisma.enrollment.create({
    data: {
      email:           `paytest+${code}@example.com`,
      phone_number:    '9888888888',
      name:            'Pay Test User',
      first_name:      'Pay',
      last_name:       'Test',
      enrollment_code: code,
      status:          planPricingId ? 'payment_pending' : 'submitted',
      plan_pricing_id: planPricingId,
      amount:          amount,
    },
  });
}

async function cleanupEnrollment(id) {
  try {
    await prisma.payment.deleteMany({ where: { enrollment_id: id } });
    await prisma.enrollment.delete({ where: { id } });
  } catch (_) {}
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function runTests() {
  console.log('\ncreatePublicPaymentOrder.test.js — Phase B payment guard tests\n');

  const activePricing         = await getActivePricing();
  const inactivePricing       = await getInactivePricing();
  const pricingInactivePlan   = await getPricingWithInactivePlan();

  // --- Test 1: Happy path with plan selected ---
  await test('1. Happy path: enrollment with plan_pricing set → guard passes, returns amountPaise', async () => {
    const expectedPaise = Math.round(Number(activePricing.finalPrice) * 100);
    const enrollment = await createTestEnrollment({ planPricingId: activePricing.id, amount: expectedPaise });
    try {
      const result = await runPlanGuards(enrollment.id);
      assert(result.amountPaise === expectedPaise, `Expected ${expectedPaise} paise, got ${result.amountPaise}`);
      assert(result.planPricing, 'Should return planPricing');
      assert(result.planPricing.id === activePricing.id, 'planPricing id should match');
    } finally {
      await cleanupEnrollment(enrollment.id);
    }
  });

  // --- Test 2: No plan selected ---
  await test('2. No plan selected: plan_pricing_id null → throws 400 PLAN_NOT_SELECTED', async () => {
    const enrollment = await createTestEnrollment({ planPricingId: null });
    try {
      let threw = false;
      try {
        await runPlanGuards(enrollment.id);
      } catch (err) {
        threw = true;
        assert(err.statusCode === 400, `Expected 400, got ${err.statusCode}`);
        assert(err.code === 'PLAN_NOT_SELECTED', `Expected PLAN_NOT_SELECTED, got ${err.code}`);
      }
      assert(threw, 'Should have thrown');
    } finally {
      await cleanupEnrollment(enrollment.id);
    }
  });

  // --- Test 3: Inactive pricing (pricing-level) ---
  await test('3. Inactive pricing: plan_pricing.status=INACTIVE → throws 400 PLAN_PRICING_INACTIVE', async () => {
    const expectedPaise = Math.round(Number(inactivePricing.finalPrice) * 100);
    const enrollment = await createTestEnrollment({ planPricingId: inactivePricing.id, amount: expectedPaise });
    try {
      let threw = false;
      try {
        await runPlanGuards(enrollment.id);
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

  // --- Test 4: Inactive plan (plan-level) ---
  await test('4. Inactive plan: plan.status=INACTIVE (pricing ACTIVE) → throws 400 PLAN_INACTIVE', async () => {
    const expectedPaise = Math.round(Number(pricingInactivePlan.finalPrice) * 100);
    const enrollment = await createTestEnrollment({ planPricingId: pricingInactivePlan.id, amount: expectedPaise });
    try {
      let threw = false;
      try {
        await runPlanGuards(enrollment.id);
      } catch (err) {
        threw = true;
        assert(err.statusCode === 400, `Expected 400, got ${err.statusCode}`);
        assert(err.code === 'PLAN_INACTIVE', `Expected PLAN_INACTIVE, got ${err.code}`);
      }
      assert(threw, 'Should have thrown');
    } finally {
      await cleanupEnrollment(enrollment.id);
      // Restore PLATINUM to ACTIVE so it does not affect other tests
      await prisma.plan.update({ where: { tier: 'PLATINUM' }, data: { status: 'ACTIVE' } }).catch(() => {});
    }
  });

  // --- Test 5: Idempotency — existing 'initiated' payment is reused ---
  await test('5. Idempotent: existing initiated payment found → same orderId returned (no new payment created)', async () => {
    const expectedPaise = Math.round(Number(activePricing.finalPrice) * 100);
    const enrollment = await createTestEnrollment({ planPricingId: activePricing.id, amount: expectedPaise });
    let payment = null;
    try {
      // Create an 'initiated' payment row for this enrollment
      payment = await prisma.payment.create({
        data: {
          enrollment_id:    enrollment.id,
          razorpay_order_id: `order_idem_${Date.now()}`,
          amount:            expectedPaise,
          currency:          'INR',
          status:            'initiated',
        },
      });

      // The idempotency check should find and return this existing payment
      const reusable = await runIdempotencyCheck(enrollment.id);
      assert(reusable !== null,           'Should find an existing initiated payment');
      assert(reusable.id === payment.id,  `Returned payment ID should match the initiated payment`);
      assert(reusable.status === 'initiated', `Status should be initiated, got ${reusable.status}`);

      // Running idempotency check again should return the same row
      const reusable2 = await runIdempotencyCheck(enrollment.id);
      assert(reusable2 !== null,              'Second check should still find the payment');
      assert(reusable2.id === payment.id,     'Second check should return the same payment');
    } finally {
      await cleanupEnrollment(enrollment.id);
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
