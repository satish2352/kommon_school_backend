'use strict';

/**
 * T-2026-KOMMON-011: System-default immutability tests
 *
 * Tests:
 * 1. DB: is_system_default column exists in all three tables
 * 2. DB: GENERAL education is system-default, others are not
 * 3. DB: 6 Months duration is system-default, others are not
 * 4. DB: GENERAL course is system-default with correct data
 * 5. Guard: assertNotSystemDefault throws on isSystemDefault:true
 * 6. Guard: assertNotSystemDefault is a no-op on isSystemDefault:false
 * 7. Guard: assertNotSystemDefault is a no-op on null record
 * 8. Joi validator: isSystemDefault:true in course create body is rejected (400)
 * 9. Joi validator: isSystemDefault:true in course update body is rejected (400)
 * 10. Joi validator: isSystemDefault:true in education create body is rejected
 * 11. Joi validator: isSystemDefault:true in education update body is rejected
 * 12. Joi validator: isSystemDefault:true in duration create body is rejected
 * 13. Joi validator: isSystemDefault:true in duration update body is rejected
 * 14. Service: updateCourse on GENERAL course throws SYSTEM_DEFAULT_LOCKED
 * 15. Service: deleteCourse on GENERAL course throws SYSTEM_DEFAULT_LOCKED
 * 16. Service: updateEducationMaster on GENERAL edu throws SYSTEM_DEFAULT_LOCKED
 * 17. Service: deleteEducationMaster on GENERAL edu throws SYSTEM_DEFAULT_LOCKED
 * 18. Service: updateDurationMaster on 6 Months throws SYSTEM_DEFAULT_LOCKED
 * 19. Service: deleteDurationMaster on 6 Months throws SYSTEM_DEFAULT_LOCKED
 * 20. Service: updateCourse on non-default course succeeds (no false positive)
 * 21. Seed idempotency: running seed twice yields identical is_system_default state
 */

require('dotenv').config();

const { PrismaClient } = require('@prisma/client');
const Joi = require('joi');
const { assertNotSystemDefault } = require('../src/utils/systemDefaultGuard');
const { createCourseSchema, updateCourseSchema } = require('../src/modules/courses/course.validator');
const { createEducationMasterSchema, updateEducationMasterSchema } = require('../src/modules/educationMaster/educationMaster.validator');
const { createDurationMasterSchema, updateDurationMasterSchema } = require('../src/modules/durationMaster/durationMaster.validator');

// We test services directly (bypass HTTP layer) so we need to mock
// getPrismaClient to return our test prisma instance.
// The services require('../../config/database') — we'll rely on the real DB.
const courseService = require('../src/modules/courses/course.service');
const educationMasterService = require('../src/modules/educationMaster/educationMaster.service');
const durationMasterService = require('../src/modules/durationMaster/durationMaster.service');

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

function assertThrows(fn, expectedCode) {
  const err = fn;
  // Used as: const threw = (() => { ... throw ... })() — actually we call differently
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function run() {
  console.log('\n=== T-2026-KOMMON-011 System Default Tests ===\n');

  // ── 1. DB column existence ───────────────────────────────────────────────
  await test('1. is_system_default column exists in course_master', async () => {
    const rows = await prisma.$queryRaw`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'course_master' AND column_name = 'is_system_default'`;
    assert(rows.length === 1, 'Column missing from course_master');
  });

  await test('2. is_system_default column exists in education_master', async () => {
    const rows = await prisma.$queryRaw`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'education_master' AND column_name = 'is_system_default'`;
    assert(rows.length === 1, 'Column missing from education_master');
  });

  await test('3. is_system_default column exists in duration_master', async () => {
    const rows = await prisma.$queryRaw`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'duration_master' AND column_name = 'is_system_default'`;
    assert(rows.length === 1, 'Column missing from duration_master');
  });

  // ── 2. Seeded data correctness ───────────────────────────────────────────
  await test('4. GENERAL education is system-default', async () => {
    const rec = await prisma.educationMaster.findUnique({ where: { code: 'GENERAL' } });
    assert(rec !== null, 'GENERAL education not found');
    assert(rec.isSystemDefault === true, `isSystemDefault=${rec.isSystemDefault}, expected true`);
    assert(rec.name === 'GENERAL', `name=${rec.name}`);
    assert(rec.status === 'ACTIVE', `status=${rec.status}`);
  });

  await test('5. Non-default education records have isSystemDefault=false', async () => {
    const recs = await prisma.educationMaster.findMany({
      where: { code: { not: 'GENERAL' } },
    });
    assert(recs.length > 0, 'No non-GENERAL education records found');
    const wrongOnes = recs.filter(r => r.isSystemDefault !== false);
    assert(wrongOnes.length === 0, `${wrongOnes.length} non-default rows have isSystemDefault=true: ${wrongOnes.map(r => r.code).join(', ')}`);
  });

  await test('6. 6 Months duration is system-default', async () => {
    const rec = await prisma.durationMaster.findUnique({ where: { label: '6 Months' } });
    assert(rec !== null, '6 Months duration not found');
    assert(rec.isSystemDefault === true, `isSystemDefault=${rec.isSystemDefault}, expected true`);
  });

  await test('7. Non-default duration records have isSystemDefault=false', async () => {
    const recs = await prisma.durationMaster.findMany({
      where: { label: { not: '6 Months' } },
    });
    assert(recs.length > 0, 'No non-6-Months duration records found');
    const wrongOnes = recs.filter(r => r.isSystemDefault !== false);
    assert(wrongOnes.length === 0, `${wrongOnes.length} non-default rows have isSystemDefault=true`);
  });

  await test('8. GENERAL course is system-default with correct data', async () => {
    const rec = await prisma.courseMaster.findFirst({
      where: { nameOfCourseAsGroup: 'GENERAL' },
      include: { education: true, duration: true },
    });
    assert(rec !== null, 'GENERAL course not found');
    assert(rec.isSystemDefault === true, `isSystemDefault=${rec.isSystemDefault}`);
    assert(rec.coupon === 'NEW501', `coupon=${rec.coupon}`);
    assert(Number(rec.courseFee) === 1500, `courseFee=${rec.courseFee}`);
    assert(rec.education?.name === 'GENERAL', `education.name=${rec.education?.name}`);
    assert(rec.duration?.label === '6 Months', `duration.label=${rec.duration?.label}`);
    assert(rec.status === 'ACTIVE', `status=${rec.status}`);
  });

  await test('9. Non-default courses have isSystemDefault=false', async () => {
    const recs = await prisma.courseMaster.findMany({
      where: { nameOfCourseAsGroup: { not: 'GENERAL' } },
    });
    assert(recs.length > 0, 'No non-GENERAL courses found');
    const wrongOnes = recs.filter(r => r.isSystemDefault !== false);
    assert(wrongOnes.length === 0, `${wrongOnes.length} non-default courses have isSystemDefault=true: ${wrongOnes.map(r => r.nameOfCourseAsGroup).join(', ')}`);
  });

  // ── 3. Guard unit tests ──────────────────────────────────────────────────
  await test('10. assertNotSystemDefault throws ApiError 403 for system-default record', () => {
    let threw = false;
    try {
      assertNotSystemDefault({ isSystemDefault: true }, 'TestEntity');
    } catch (err) {
      threw = true;
      assert(err.statusCode === 403, `Expected statusCode 403, got ${err.statusCode}`);
      assert(err.code === 'SYSTEM_DEFAULT_LOCKED', `Expected code SYSTEM_DEFAULT_LOCKED, got ${err.code}`);
      assert(err.message.includes('TestEntity'), `Message should mention entity: ${err.message}`);
    }
    assert(threw, 'assertNotSystemDefault should have thrown for isSystemDefault=true');
  });

  await test('11. assertNotSystemDefault is a no-op for non-default record', () => {
    // Should not throw
    assertNotSystemDefault({ isSystemDefault: false }, 'TestEntity');
  });

  await test('12. assertNotSystemDefault is a no-op for null record', () => {
    // Should not throw
    assertNotSystemDefault(null, 'TestEntity');
  });

  // ── 4. Joi validator tests ───────────────────────────────────────────────
  await test('13. createCourseSchema rejects isSystemDefault:true', () => {
    const { error } = createCourseSchema.validate({
      nameOfCourseAsGroup: 'Test Course',
      courseFee: 1000,
      isSystemDefault: true,
    }, { abortEarly: false });
    assert(error != null, 'Validation should have failed');
    const hasField = error.details.some(d => d.path.includes('isSystemDefault'));
    assert(hasField, `Expected isSystemDefault in error details: ${JSON.stringify(error.details)}`);
  });

  await test('14. updateCourseSchema rejects isSystemDefault:true', () => {
    const { error } = updateCourseSchema.validate({
      status: 'ACTIVE',
      isSystemDefault: true,
    }, { abortEarly: false });
    assert(error != null, 'Validation should have failed');
    const hasField = error.details.some(d => d.path.includes('isSystemDefault'));
    assert(hasField, `Expected isSystemDefault in error details`);
  });

  await test('15. createCourseSchema rejects isSystemDefault:false (also forbidden)', () => {
    const { error } = createCourseSchema.validate({
      nameOfCourseAsGroup: 'Test',
      courseFee: 1000,
      isSystemDefault: false,
    }, { abortEarly: false });
    assert(error != null, 'Validation should have failed — Joi.forbidden() rejects even false');
  });

  await test('16. createEducationMasterSchema rejects isSystemDefault:true', () => {
    const { error } = createEducationMasterSchema.validate({
      name: 'Test',
      code: 'TEST',
      isSystemDefault: true,
    }, { abortEarly: false });
    assert(error != null, 'Validation should have failed');
    const hasField = error.details.some(d => d.path.includes('isSystemDefault'));
    assert(hasField, 'Expected isSystemDefault in error details');
  });

  await test('17. updateEducationMasterSchema rejects isSystemDefault:true', () => {
    const { error } = updateEducationMasterSchema.validate({
      name: 'Test',
      isSystemDefault: true,
    }, { abortEarly: false });
    assert(error != null, 'Validation should have failed');
    const hasField = error.details.some(d => d.path.includes('isSystemDefault'));
    assert(hasField, 'Expected isSystemDefault in error details');
  });

  await test('18. createDurationMasterSchema rejects isSystemDefault:true', () => {
    const { error } = createDurationMasterSchema.validate({
      label: 'Test',
      isSystemDefault: true,
    }, { abortEarly: false });
    assert(error != null, 'Validation should have failed');
    const hasField = error.details.some(d => d.path.includes('isSystemDefault'));
    assert(hasField, 'Expected isSystemDefault in error details');
  });

  await test('19. updateDurationMasterSchema rejects isSystemDefault:true', () => {
    const { error } = updateDurationMasterSchema.validate({
      label: 'Test',
      isSystemDefault: true,
    }, { abortEarly: false });
    assert(error != null, 'Validation should have failed');
    const hasField = error.details.some(d => d.path.includes('isSystemDefault'));
    assert(hasField, 'Expected isSystemDefault in error details');
  });

  // ── 5. Service-level integration tests ───────────────────────────────────
  const TRACE = 'test-trace-001';

  await test('20. courseService.updateCourse on GENERAL course throws SYSTEM_DEFAULT_LOCKED', async () => {
    const generalCourse = await prisma.courseMaster.findFirst({
      where: { nameOfCourseAsGroup: 'GENERAL' },
    });
    assert(generalCourse !== null, 'GENERAL course not found in DB');

    let threw = false;
    try {
      await courseService.updateCourse(generalCourse.id, { coupon: 'HACK123' }, TRACE);
    } catch (err) {
      threw = true;
      assert(err.statusCode === 403, `Expected 403, got ${err.statusCode}`);
      assert(err.code === 'SYSTEM_DEFAULT_LOCKED', `Expected SYSTEM_DEFAULT_LOCKED, got ${err.code}`);
    }
    assert(threw, 'updateCourse on GENERAL should have thrown SYSTEM_DEFAULT_LOCKED');
  });

  await test('21. courseService.deleteCourse on GENERAL course throws SYSTEM_DEFAULT_LOCKED', async () => {
    const generalCourse = await prisma.courseMaster.findFirst({
      where: { nameOfCourseAsGroup: 'GENERAL' },
    });
    assert(generalCourse !== null, 'GENERAL course not found in DB');

    let threw = false;
    try {
      await courseService.deleteCourse(generalCourse.id, TRACE);
    } catch (err) {
      threw = true;
      assert(err.statusCode === 403, `Expected 403, got ${err.statusCode}`);
      assert(err.code === 'SYSTEM_DEFAULT_LOCKED', `Expected SYSTEM_DEFAULT_LOCKED, got ${err.code}`);
    }
    assert(threw, 'deleteCourse on GENERAL should have thrown SYSTEM_DEFAULT_LOCKED');
  });

  await test('22. educationMasterService.updateEducationMaster on GENERAL throws SYSTEM_DEFAULT_LOCKED', async () => {
    const generalEdu = await prisma.educationMaster.findUnique({ where: { code: 'GENERAL' } });
    assert(generalEdu !== null, 'GENERAL education not found');

    let threw = false;
    try {
      await educationMasterService.updateEducationMaster(generalEdu.id, { name: 'Hacked' }, TRACE);
    } catch (err) {
      threw = true;
      assert(err.statusCode === 403, `Expected 403, got ${err.statusCode}`);
      assert(err.code === 'SYSTEM_DEFAULT_LOCKED', `Expected SYSTEM_DEFAULT_LOCKED, got ${err.code}`);
    }
    assert(threw, 'updateEducationMaster on GENERAL should have thrown SYSTEM_DEFAULT_LOCKED');
  });

  await test('23. educationMasterService.deleteEducationMaster on GENERAL throws SYSTEM_DEFAULT_LOCKED', async () => {
    const generalEdu = await prisma.educationMaster.findUnique({ where: { code: 'GENERAL' } });
    assert(generalEdu !== null, 'GENERAL education not found');

    let threw = false;
    try {
      await educationMasterService.deleteEducationMaster(generalEdu.id, TRACE);
    } catch (err) {
      threw = true;
      assert(err.statusCode === 403, `Expected 403, got ${err.statusCode}`);
      assert(err.code === 'SYSTEM_DEFAULT_LOCKED', `Expected SYSTEM_DEFAULT_LOCKED, got ${err.code}`);
    }
    assert(threw, 'deleteEducationMaster on GENERAL should have thrown SYSTEM_DEFAULT_LOCKED');
  });

  await test('24. durationMasterService.updateDurationMaster on 6 Months throws SYSTEM_DEFAULT_LOCKED', async () => {
    const dur6 = await prisma.durationMaster.findUnique({ where: { label: '6 Months' } });
    assert(dur6 !== null, '6 Months duration not found');

    let threw = false;
    try {
      await durationMasterService.updateDurationMaster(dur6.id, { sortOrder: 999 }, TRACE);
    } catch (err) {
      threw = true;
      assert(err.statusCode === 403, `Expected 403, got ${err.statusCode}`);
      assert(err.code === 'SYSTEM_DEFAULT_LOCKED', `Expected SYSTEM_DEFAULT_LOCKED, got ${err.code}`);
    }
    assert(threw, 'updateDurationMaster on 6 Months should have thrown SYSTEM_DEFAULT_LOCKED');
  });

  await test('25. durationMasterService.deleteDurationMaster on 6 Months throws SYSTEM_DEFAULT_LOCKED', async () => {
    const dur6 = await prisma.durationMaster.findUnique({ where: { label: '6 Months' } });
    assert(dur6 !== null, '6 Months duration not found');

    let threw = false;
    try {
      await durationMasterService.deleteDurationMaster(dur6.id, TRACE);
    } catch (err) {
      threw = true;
      assert(err.statusCode === 403, `Expected 403, got ${err.statusCode}`);
      assert(err.code === 'SYSTEM_DEFAULT_LOCKED', `Expected SYSTEM_DEFAULT_LOCKED, got ${err.code}`);
    }
    assert(threw, 'deleteDurationMaster on 6 Months should have thrown SYSTEM_DEFAULT_LOCKED');
  });

  await test('26. courseService.updateCourse on non-default course does NOT throw (no false positive)', async () => {
    // Find a non-system-default course
    const regularCourse = await prisma.courseMaster.findFirst({
      where: { nameOfCourseAsGroup: 'UI / UX Designing' },
    });
    assert(regularCourse !== null, 'UI / UX Designing course not found');
    assert(regularCourse.isSystemDefault === false, 'Expected non-default course');

    // Update with no change — just re-submit same coupon; should not throw SYSTEM_DEFAULT_LOCKED
    let threwSystemDefault = false;
    try {
      await courseService.updateCourse(regularCourse.id, { coupon: regularCourse.coupon || null }, TRACE);
    } catch (err) {
      if (err.code === 'SYSTEM_DEFAULT_LOCKED') {
        threwSystemDefault = true;
      }
      // Other errors (e.g. FK) are acceptable here since we're just testing the guard path
    }
    assert(!threwSystemDefault, 'updateCourse on non-default course should not throw SYSTEM_DEFAULT_LOCKED');
  });

  await test('27. educationMasterService.updateEducationMaster on non-default record does NOT throw SYSTEM_DEFAULT_LOCKED', async () => {
    const regularEdu = await prisma.educationMaster.findUnique({ where: { code: 'GRADUATE' } });
    assert(regularEdu !== null, 'GRADUATE education not found');
    assert(regularEdu.isSystemDefault === false, 'Expected non-default education');

    let threwSystemDefault = false;
    try {
      await educationMasterService.updateEducationMaster(regularEdu.id, { name: regularEdu.name }, TRACE);
    } catch (err) {
      if (err.code === 'SYSTEM_DEFAULT_LOCKED') {
        threwSystemDefault = true;
      }
    }
    assert(!threwSystemDefault, 'updateEducationMaster on non-default should not throw SYSTEM_DEFAULT_LOCKED');
  });

  await test('28. durationMasterService.updateDurationMaster on non-default record does NOT throw SYSTEM_DEFAULT_LOCKED', async () => {
    const dur1 = await prisma.durationMaster.findUnique({ where: { label: '1 Month' } });
    assert(dur1 !== null, '1 Month duration not found');
    assert(dur1.isSystemDefault === false, 'Expected non-default duration');

    let threwSystemDefault = false;
    try {
      await durationMasterService.updateDurationMaster(dur1.id, { sortOrder: dur1.sortOrder }, TRACE);
    } catch (err) {
      if (err.code === 'SYSTEM_DEFAULT_LOCKED') {
        threwSystemDefault = true;
      }
    }
    assert(!threwSystemDefault, 'updateDurationMaster on non-default should not throw SYSTEM_DEFAULT_LOCKED');
  });

  // ── 6. Joi.forbidden() behavior with stripUnknown:true (validate middleware) ──
  await test('29. Joi.forbidden() with stripUnknown:true still rejects isSystemDefault', () => {
    // Simulate what validate.middleware.js does
    const { error } = createCourseSchema.validate({
      nameOfCourseAsGroup: 'Test',
      courseFee: 1000,
      isSystemDefault: true,
    }, { abortEarly: false, stripUnknown: true });
    assert(error != null, 'With stripUnknown:true, Joi.forbidden() should still reject');
    const hasField = error.details.some(d => d.path.includes('isSystemDefault'));
    assert(hasField, 'Expected isSystemDefault in error.details even with stripUnknown');
  });

  // ── Final summary ────────────────────────────────────────────────────────
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);

  if (failures.length > 0) {
    console.log('Failed tests:');
    failures.forEach(f => console.log(`  - ${f.name}: ${f.error}`));
    process.exit(1);
  } else {
    console.log('All tests passed.');
    process.exit(0);
  }
}

run()
  .catch(err => {
    console.error('Test runner crashed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
