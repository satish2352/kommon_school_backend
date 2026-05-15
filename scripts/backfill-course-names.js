'use strict';

/**
 * backfill-course-names.js
 *
 * One-off migration script:
 *   1. Reads all distinct nameOfCourseAsGroup values from course_master
 *   2. Upserts each into course_name_master (idempotent)
 *   3. Updates each course_master row's courseNameId to the matching record
 *   4. Verifies that all course_master rows have a non-null courseNameId
 *
 * Usage:
 *   node scripts/backfill-course-names.js
 */

require('dotenv').config();

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  console.log('[backfill] Starting CourseNameMaster backfill...\n');

  // ── Step 1: Read all distinct nameOfCourseAsGroup values ──────────────────
  const courseRows = await prisma.courseMaster.findMany({
    select: { id: true, nameOfCourseAsGroup: true, courseNameId: true },
    orderBy: { id: 'asc' },
  });

  const distinctNames = [
    ...new Set(courseRows.map((r) => r.nameOfCourseAsGroup.trim()).filter(Boolean)),
  ];

  console.log(`[backfill] Found ${courseRows.length} course_master rows`);
  console.log(`[backfill] Found ${distinctNames.length} distinct course names:\n`);
  distinctNames.forEach((n) => console.log(`  - ${n}`));
  console.log('');

  // ── Step 2: Upsert each name into course_name_master ─────────────────────
  let namesCreated = 0;
  let namesExisted = 0;
  const nameToId = new Map();

  for (const name of distinctNames) {
    // Check if already exists
    const existing = await prisma.courseNameMaster.findUnique({ where: { name } });
    if (existing) {
      namesExisted++;
      nameToId.set(name, existing.id);
      console.log(`[backfill] Name already exists (id=${existing.id}): "${name}"`);
    } else {
      const created = await prisma.courseNameMaster.create({
        data: { name, status: 'ACTIVE' },
      });
      namesCreated++;
      nameToId.set(name, created.id);
      console.log(`[backfill] Created (id=${created.id}): "${name}"`);
    }
  }

  console.log(`\n[backfill] Names created: ${namesCreated}, already existed: ${namesExisted}\n`);

  // ── Step 3: Update each course_master row's courseNameId ──────────────────
  let rowsUpdated = 0;
  let rowsSkipped = 0;

  for (const row of courseRows) {
    const targetId = nameToId.get(row.nameOfCourseAsGroup.trim());
    if (!targetId) {
      console.warn(`[backfill] WARNING: No nameId found for course id=${row.id} name="${row.nameOfCourseAsGroup}" — skipping`);
      continue;
    }
    if (row.courseNameId === targetId) {
      rowsSkipped++;
      continue;
    }
    await prisma.courseMaster.update({
      where: { id: row.id },
      data: { courseNameId: targetId },
    });
    rowsUpdated++;
    console.log(`[backfill] Updated course id=${row.id} → courseNameId=${targetId}`);
  }

  console.log(`\n[backfill] Rows updated: ${rowsUpdated}, rows already correct: ${rowsSkipped}\n`);

  // ── Step 4: Verify ────────────────────────────────────────────────────────
  const nullRows = await prisma.courseMaster.findMany({
    where: { courseNameId: null },
    select: { id: true, nameOfCourseAsGroup: true },
  });

  if (nullRows.length > 0) {
    console.error(`[backfill] VERIFICATION FAILED — ${nullRows.length} course_master row(s) still have null courseNameId:`);
    nullRows.forEach((r) => console.error(`  id=${r.id} name="${r.nameOfCourseAsGroup}"`));
    process.exit(1);
  }

  const totalCourses = await prisma.courseMaster.count();
  const totalNames   = await prisma.courseNameMaster.count();

  console.log('[backfill] VERIFICATION PASSED');
  console.log(`[backfill] Summary:`);
  console.log(`  course_name_master rows: ${totalNames}`);
  console.log(`  course_master rows with courseNameId set: ${totalCourses}`);
  console.log('\n[backfill] Done.');
}

main()
  .catch((err) => {
    console.error('[backfill] Fatal error:', err.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
