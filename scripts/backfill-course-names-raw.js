'use strict';

/**
 * backfill-course-names-raw.js
 *
 * Raw SQL backfill using Prisma $queryRawUnsafe / $executeRawUnsafe.
 * Works even when the Prisma client hasn't been regenerated yet,
 * because raw SQL bypasses the typed client model layer.
 */

require('dotenv').config();
// Load database config via the app's existing helper
const { getPrismaClient } = require('../src/config/database');

async function main() {
  const db = getPrismaClient();
  console.log('[backfill] Starting CourseNameMaster backfill (raw SQL mode)...\n');

  // ── Step 1: Read all course_master rows ───────────────────────────────────
  const courseRows = await db.$queryRawUnsafe(
    `SELECT id, name_of_course_as_group, course_name_id FROM course_master ORDER BY id`
  );

  const distinctNames = [
    ...new Set(courseRows.map((r) => r.name_of_course_as_group.trim()).filter(Boolean)),
  ];

  console.log(`[backfill] Found ${courseRows.length} course_master rows`);
  console.log(`[backfill] Found ${distinctNames.length} distinct course names:\n`);
  distinctNames.forEach((n) => console.log(`  - ${n}`));
  console.log('');

  // ── Step 2: Upsert each name into course_name_master ──────────────────────
  let namesCreated = 0;
  let namesExisted = 0;
  const nameToId = new Map();

  for (const name of distinctNames) {
    const existing = await db.$queryRawUnsafe(
      `SELECT id FROM course_name_master WHERE name = $1`,
      name
    );

    if (existing.length > 0) {
      namesExisted++;
      nameToId.set(name, Number(existing[0].id));
      console.log(`[backfill] Already exists (id=${existing[0].id}): "${name}"`);
    } else {
      const created = await db.$queryRawUnsafe(
        `INSERT INTO course_name_master (name, status, is_system_default, created_at, updated_at)
         VALUES ($1, 'ACTIVE', false, now(), now())
         RETURNING id`,
        name
      );
      namesCreated++;
      nameToId.set(name, Number(created[0].id));
      console.log(`[backfill] Created (id=${created[0].id}): "${name}"`);
    }
  }

  console.log(`\n[backfill] Names created: ${namesCreated}, already existed: ${namesExisted}\n`);

  // ── Step 3: Update each course_master row's course_name_id ─────────────────
  let rowsUpdated = 0;
  let rowsSkipped = 0;

  for (const row of courseRows) {
    const targetId = nameToId.get(row.name_of_course_as_group.trim());
    if (!targetId) {
      console.warn(`[backfill] WARNING: No nameId for course id=${row.id} — skipping`);
      continue;
    }
    // course_name_id from DB may be null or a BigInt from Prisma raw
    const currentNameId = row.course_name_id != null ? Number(row.course_name_id) : null;
    if (currentNameId === targetId) {
      rowsSkipped++;
      continue;
    }
    await db.$executeRawUnsafe(
      `UPDATE course_master SET course_name_id = $1, updated_at = now() WHERE id = $2`,
      targetId,
      Number(row.id)
    );
    rowsUpdated++;
    console.log(`[backfill] Updated course id=${row.id} → course_name_id=${targetId}`);
  }

  console.log(`\n[backfill] Rows updated: ${rowsUpdated}, rows already correct: ${rowsSkipped}\n`);

  // ── Step 4: Verify ──────────────────────────────────────────────────────────
  const nullRows = await db.$queryRawUnsafe(
    `SELECT id, name_of_course_as_group FROM course_master WHERE course_name_id IS NULL`
  );

  if (nullRows.length > 0) {
    console.error(`[backfill] VERIFICATION FAILED — ${nullRows.length} row(s) still have null course_name_id:`);
    nullRows.forEach((r) => console.error(`  id=${r.id} name="${r.name_of_course_as_group}"`));
    process.exit(1);
  }

  const [{ total_courses }] = await db.$queryRawUnsafe(`SELECT count(*)::int AS total_courses FROM course_master`);
  const [{ total_names }]   = await db.$queryRawUnsafe(`SELECT count(*)::int AS total_names FROM course_name_master`);

  console.log('[backfill] VERIFICATION PASSED');
  console.log('[backfill] Summary:');
  console.log(`  course_name_master rows : ${total_names}`);
  console.log(`  course_master rows      : ${total_courses} (all have course_name_id set)`);
  console.log('\n[backfill] Done.');
}

main()
  .catch((err) => {
    console.error('[backfill] Fatal:', err.message);
    process.exit(1);
  })
  .finally(async () => {
    const db = getPrismaClient();
    await db.$disconnect();
  });
