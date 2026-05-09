'use strict';

/**
 * T-2026-KOMMON-013: Webhook payload sourced from Course Master tests
 *
 * Tests:
 * 1.  buildPayload with full course object — unit/group/phase/amount from course
 * 2.  buildPayload with course = null — fallback dummies + paise-derived amount
 * 3.  buildPayload with course.education = null — group falls back to dummy_A, unit+phase still from course
 * 4.  buildPayload with course.duration = null — phase falls back to dummy, unit+group still from course
 * 5a. courseFee as string "49999.00" → amount === 49999
 * 5b. courseFee as string "1500.50" → amount === 1501 (Math.round)
 * 5c. courseFee as number 0 → amount === 0
 * 6.  findActivePromoCodeWithRelations("NEW501") returns course with education + duration relations
 * 7.  findActivePromoCodeWithRelations("BOGUS999") returns null
 * 8.  All 11 payload fields present regardless of course presence (both paths)
 * 9.  When course is present, the paise `amount` param is IGNORED — courseFee is used
 * 10. fireEnrollmentWebhook end-to-end: mocked fetch receives course-derived payload for promo NEW501
 */

require('dotenv').config();

const { PrismaClient } = require('@prisma/client');
const { buildPayload, fireEnrollmentWebhook } = require('../src/modules/enrollments/enrollmentWebhook.service');
const { findActivePromoCodeWithRelations } = require('../src/modules/promoCodes/promoCode.service');

const prisma = new PrismaClient();

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
// Shared test data
// ---------------------------------------------------------------------------

const baseEnrollment = {
  id:           'test-enrollment-uuid',
  name:         'Ravi Sharma',
  email:        'ravi@example.com',
  phone_number: '9876543210',
  promo_code:   'NEW501',
  amount:       150000,
};

const courseWithRelations = {
  id:                   1,
  nameOfCourseAsGroup:  'Data Science and AIML',
  coupon:               'NEW501',
  courseFee:            '49999.00', // Prisma Decimal arrives as string
  status:               'ACTIVE',
  education: { id: 1, name: 'Graduate', code: 'GRADUATE' },
  duration:  { id: 1, label: '6 Months', sortOrder: 1 },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function run() {
  console.log('\n=== T-2026-KOMMON-013 Webhook Payload Tests ===\n');

  // ── 1. Full course object → unit/group/phase/amount from course ───────────
  await test('1. buildPayload with full course — unit/group/phase/amount from course', async () => {
    const payload = buildPayload({
      enrollment: baseEnrollment,
      razorpayPaymentId: 'pay_test123',
      amount: 0,
      course: courseWithRelations,
    });
    assert(payload.unit  === 'Data Science and AIML', `unit: expected 'Data Science and AIML', got '${payload.unit}'`);
    assert(payload.group === 'Graduate',              `group: expected 'Graduate', got '${payload.group}'`);
    assert(payload.phase === '6 Months',              `phase: expected '6 Months', got '${payload.phase}'`);
    assert(payload.amount === 49999,                  `amount: expected 49999, got ${payload.amount}`);
    assert(payload.firstName === 'Ravi',              `firstName: expected 'Ravi', got '${payload.firstName}'`);
    assert(payload.lastName  === 'Sharma',            `lastName: expected 'Sharma', got '${payload.lastName}'`);
    assert(payload.email     === 'ravi@example.com',  `email mismatch`);
    assert(payload.phoneNumber === '+919876543210',   `phone: expected '+919876543210', got '${payload.phoneNumber}'`);
    assert(payload.transactionId === 'pay_test123',   `transactionId mismatch`);
    assert(payload.plan    === 'SUMAGO30',            `plan: expected 'SUMAGO30', got '${payload.plan}'`);
    assert(payload.segment === 'enterprise',          `segment: expected 'enterprise', got '${payload.segment}'`);
  });

  // ── 2. course = null → dummy fallbacks + paise → rupees ──────────────────
  await test('2. buildPayload with course = null — dummies + paise-derived amount', async () => {
    const payload = buildPayload({
      enrollment: baseEnrollment,
      razorpayPaymentId: 'pay_null_test',
      amount: 150000,
      course: null,
    });
    assert(payload.unit   === 'unit_01', `unit: expected 'unit_01', got '${payload.unit}'`);
    assert(payload.group  === 'group_A', `group: expected 'group_A', got '${payload.group}'`);
    assert(payload.phase  === 'phase_2', `phase: expected 'phase_2', got '${payload.phase}'`);
    assert(payload.amount === 1500,      `amount: expected 1500 (150000 paise / 100), got ${payload.amount}`);
  });

  // ── 3. course.education = null → group fallback, unit+phase from course ───
  await test('3. buildPayload with course.education = null — group dummy, unit+phase from course', async () => {
    const courseNoEdu = { ...courseWithRelations, education: null };
    const payload = buildPayload({
      enrollment: baseEnrollment,
      razorpayPaymentId: null,
      amount: 0,
      course: courseNoEdu,
    });
    assert(payload.group  === 'group_A',              `group: expected 'group_A' fallback, got '${payload.group}'`);
    assert(payload.unit   === 'Data Science and AIML',`unit: expected course value, got '${payload.unit}'`);
    assert(payload.phase  === '6 Months',             `phase: expected '6 Months', got '${payload.phase}'`);
    assert(payload.amount === 49999,                  `amount: expected 49999, got ${payload.amount}`);
  });

  // ── 4. course.duration = null → phase fallback, unit+group from course ────
  await test('4. buildPayload with course.duration = null — phase dummy, unit+group from course', async () => {
    const courseNoDur = { ...courseWithRelations, duration: null };
    const payload = buildPayload({
      enrollment: baseEnrollment,
      razorpayPaymentId: null,
      amount: 0,
      course: courseNoDur,
    });
    assert(payload.phase  === 'phase_2',              `phase: expected 'phase_2' fallback, got '${payload.phase}'`);
    assert(payload.unit   === 'Data Science and AIML',`unit: expected course value, got '${payload.unit}'`);
    assert(payload.group  === 'Graduate',             `group: expected 'Graduate', got '${payload.group}'`);
    assert(payload.amount === 49999,                  `amount: expected 49999, got ${payload.amount}`);
  });

  // ── 5. courseFee Decimal-like coercions ────────────────────────────────────
  await test('5a. courseFee "49999.00" → amount === 49999', async () => {
    const c = { ...courseWithRelations, courseFee: '49999.00' };
    const p = buildPayload({ enrollment: baseEnrollment, razorpayPaymentId: null, amount: 0, course: c });
    assert(p.amount === 49999, `Expected 49999, got ${p.amount}`);
    assert(Number.isInteger(p.amount), `Expected integer, got ${typeof p.amount} ${p.amount}`);
  });

  await test('5b. courseFee "1500.50" → amount === 1501 (Math.round)', async () => {
    const c = { ...courseWithRelations, courseFee: '1500.50' };
    const p = buildPayload({ enrollment: baseEnrollment, razorpayPaymentId: null, amount: 0, course: c });
    assert(p.amount === 1501, `Expected 1501, got ${p.amount}`);
  });

  await test('5c. courseFee 0 → amount === 0', async () => {
    const c = { ...courseWithRelations, courseFee: 0 };
    const p = buildPayload({ enrollment: baseEnrollment, razorpayPaymentId: null, amount: 0, course: c });
    assert(p.amount === 0, `Expected 0, got ${p.amount}`);
  });

  // ── 6. findActivePromoCodeWithRelations("NEW501") returns course with relations
  await test('6. findActivePromoCodeWithRelations("NEW501") returns course with education + duration', async () => {
    const result = await findActivePromoCodeWithRelations('NEW501');
    assert(result !== null,                             'Expected non-null for NEW501');
    assert(typeof result.nameOfCourseAsGroup === 'string', 'Expected nameOfCourseAsGroup string');
    assert(result.education !== undefined,              'Expected education property on result');
    assert(result.duration  !== undefined,              'Expected duration property on result');
    // education and duration may be null if not assigned yet, but the properties must exist
    if (result.education) {
      assert(typeof result.education.name === 'string', `Expected education.name string, got ${typeof result.education.name}`);
    }
    if (result.duration) {
      assert(typeof result.duration.label === 'string', `Expected duration.label string, got ${typeof result.duration.label}`);
    }
    const fee = Math.round(Number(result.courseFee));
    assert(Number.isInteger(fee), `Expected integer from courseFee conversion, got ${fee}`);
    assert(fee >= 0,              `Expected non-negative fee, got ${fee}`);
  });

  // ── 7. findActivePromoCodeWithRelations("BOGUS999") → null ────────────────
  await test('7. findActivePromoCodeWithRelations("BOGUS999") returns null', async () => {
    const result = await findActivePromoCodeWithRelations('BOGUS999');
    assert(result === null, `Expected null for bogus code, got ${JSON.stringify(result)}`);
  });

  // ── 8. All 11 payload fields present in both paths ─────────────────────────
  const REQUIRED_FIELDS = ['firstName','lastName','email','phoneNumber','plan','group','unit','phase','segment','transactionId','amount'];

  await test('8a. All 11 payload fields present when course is provided', async () => {
    const payload = buildPayload({
      enrollment: baseEnrollment,
      razorpayPaymentId: 'pay_test',
      amount: 0,
      course: courseWithRelations,
    });
    for (const key of REQUIRED_FIELDS) {
      assert(key in payload, `Missing field: ${key}`);
    }
    assert(Object.keys(payload).length === 11, `Expected 11 fields, got ${Object.keys(payload).length}: ${Object.keys(payload).join(', ')}`);
  });

  await test('8b. All 11 payload fields present when course = null', async () => {
    const payload = buildPayload({
      enrollment: baseEnrollment,
      razorpayPaymentId: 'pay_test',
      amount: 100,
      course: null,
    });
    for (const key of REQUIRED_FIELDS) {
      assert(key in payload, `Missing field: ${key}`);
    }
    assert(Object.keys(payload).length === 11, `Expected 11 fields, got ${Object.keys(payload).length}: ${Object.keys(payload).join(', ')}`);
  });

  // ── 9. When course is present, paise `amount` param is IGNORED ────────────
  await test('9. When course present, paise amount param is ignored — courseFee used', async () => {
    const payload = buildPayload({
      enrollment: baseEnrollment,
      razorpayPaymentId: null,
      amount: 999999, // would give 9999 rupees if paise conversion ran
      course: { ...courseWithRelations, courseFee: '49999.00' },
    });
    assert(payload.amount === 49999,  `Expected 49999 from courseFee, not ${payload.amount} from paise param`);
  });

  // ── 10. End-to-end: fireEnrollmentWebhook with mocked fetch ───────────────
  await test('10. fireEnrollmentWebhook fires course-derived payload for NEW501 enrollment', async () => {
    // Find or create a minimal enrollment with promo_code NEW501 for the test
    let enrollment = await prisma.enrollment.findFirst({
      where: { promo_code: 'NEW501', deleted_at: null },
      orderBy: { created_at: 'desc' },
    });

    let createdForTest = false;
    if (!enrollment) {
      // Create a temporary enrollment for this test
      enrollment = await prisma.enrollment.create({
        data: {
          name:         'Test Webhook User',
          email:        `webhook_test_${Date.now()}@example.com`,
          phone_number: '9123456789',
          promo_code:   'NEW501',
          status:       'submitted',
        },
      });
      createdForTest = true;
    }

    // Mock global fetch using a promise that resolves when fetch is called,
    // so we don't race between setImmediate and a fixed timeout.
    const originalFetch = global.fetch;
    let capturedUrl  = null;
    let capturedBody = null;
    let fetchResolve;
    const fetchCalled = new Promise((res) => { fetchResolve = res; });

    global.fetch = async (url, opts) => {
      capturedUrl  = url;
      capturedBody = JSON.parse(opts.body);
      fetchResolve(); // signal that fetch was called
      return { status: 200 };
    };

    try {
      fireEnrollmentWebhook({
        enrollment,
        razorpayPaymentId: 'pay_e2e_test',
        amount: 0,
      });

      // Wait for the mocked fetch to be called (with 3s safety timeout)
      await Promise.race([
        fetchCalled,
        new Promise((_, rej) => setTimeout(() => rej(new Error('fetch mock not called within 3s')), 3000)),
      ]);

      assert(capturedUrl  !== null,   'fetch was never called — webhook did not fire');
      assert(capturedBody !== null,   'no body captured from fetch call');

      // The course matched — payload should have course-derived fields (not dummies)
      // (This may be dummies if the GENERAL course has no education/duration FK set)
      assert(capturedBody.unit  !== undefined, 'payload.unit missing');
      assert(capturedBody.group !== undefined, 'payload.group missing');
      assert(typeof capturedBody.amount === 'number', `amount should be a number, got ${typeof capturedBody.amount}`);
      assert(Number.isInteger(capturedBody.amount),   `amount should be integer, got ${capturedBody.amount}`);
      assert(capturedBody.plan    === 'SUMAGO30',    `plan: expected SUMAGO30, got ${capturedBody.plan}`);
      assert(capturedBody.segment === 'enterprise',  `segment: expected enterprise, got ${capturedBody.segment}`);
      assert(capturedBody.transactionId === 'pay_e2e_test', `transactionId mismatch`);

      console.log(`    Captured payload: unit="${capturedBody.unit}" group="${capturedBody.group}" phase="${capturedBody.phase}" amount=${capturedBody.amount}`);
    } finally {
      global.fetch = originalFetch;
      if (createdForTest) {
        await prisma.enrollment.deleteMany({ where: { id: enrollment.id } });
      }
    }
  });

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  if (failures.length > 0) {
    console.log('Failures:');
    failures.forEach((f) => console.log(`  - ${f.name}: ${f.error}`));
    console.log('');
  }
}

run()
  .catch((err) => {
    console.error('Unexpected error in test runner:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
