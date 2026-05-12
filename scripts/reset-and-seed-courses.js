'use strict';

/**
 * reset-and-seed-courses.js
 *
 * Wipe non-user tables, then seed 5 durations and 35 course rows.
 *
 * NOTE: Uses Prisma model `deleteMany` per table (issues a `DELETE FROM ...`
 *       statement, no CASCADE / lock-the-whole-table TRUNCATE) — the remote
 *       Postgres dropped the connection mid-TRUNCATE ... CASCADE in earlier
 *       attempts (P1017), likely due to a server-side statement timeout.
 *       deleteMany runs as separate small statements and avoids that path.
 */

require('dotenv').config();
const { PrismaClient, Prisma } = require('@prisma/client');

const prisma = new PrismaClient();

const COURSES = [
  'Full Stack Development Using Python',
  'UI / UX Designing',
  'Data Analytics Using Python',
  'Web Designing and Development Using React',
  'Mobile Application Development',
  'Full Stack Java Development',
  'Data Science and AI / ML',
];

const DURATIONS = [
  { label: '30 Days',  sortOrder: 30  },
  { label: '45 Days',  sortOrder: 45  },
  { label: '3 Months', sortOrder: 90  },
  { label: '6 Months', sortOrder: 180 },
  { label: '9 Months', sortOrder: 270 },
];

async function deleteAll(label, fn) {
  const t0 = Date.now();
  try {
    const { count } = await fn();
    console.log(`  ${label.padEnd(28)} deleted ${count} rows (${Date.now() - t0}ms)`);
  } catch (err) {
    console.log(`  ${label.padEnd(28)} FAILED: ${err.message}`);
    throw err;
  }
}

async function main() {
  // ---------------------------------------------------------------------------
  // 1. Delete non-user tables in FK-safe order (leaves to roots).
  //    PRESERVE: users, permissions, role_permissions, razorpay_configurations.
  // ---------------------------------------------------------------------------
  console.log('[reset] deleting rows in FK-safe order…');
  await deleteAll('followup_notes',    () => prisma.followupNote.deleteMany({}));
  await deleteAll('followups',         () => prisma.followup.deleteMany({}));
  await deleteAll('audit_logs',        () => prisma.auditLog.deleteMany({}));
  await deleteAll('external_api_logs', () => prisma.externalApiLog.deleteMany({}));
  await deleteAll('webhook_delivery',  () => prisma.webhookDelivery.deleteMany({}));
  await deleteAll('webhook_events',    () => prisma.webhookEvent.deleteMany({}));
  await deleteAll('payments',          () => prisma.payment.deleteMany({}));
  await deleteAll('enrollments',       () => prisma.enrollment.deleteMany({}));
  await deleteAll('refresh_tokens',    () => prisma.refreshToken.deleteMany({}));
  await deleteAll('plan_pricing',      () => prisma.planPricing.deleteMany({}));
  await deleteAll('plans',             () => prisma.plan.deleteMany({}));
  await deleteAll('course_master',     () => prisma.courseMaster.deleteMany({}));
  await deleteAll('duration_master',   () => prisma.durationMaster.deleteMany({}));
  await deleteAll('education_master',  () => prisma.educationMaster.deleteMany({}));
  console.log('[reset] done.');

  // ---------------------------------------------------------------------------
  // 2. Insert durations.
  // ---------------------------------------------------------------------------
  console.log('[seed] inserting durations…');
  const durationByLabel = {};
  for (const d of DURATIONS) {
    const row = await prisma.durationMaster.create({
      data: {
        label:     d.label,
        sortOrder: d.sortOrder,
        status:    'ACTIVE',
      },
    });
    durationByLabel[d.label] = row;
    console.log(`  + duration: ${d.label} (id=${row.id})`);
  }

  // ---------------------------------------------------------------------------
  // 3. Insert one course_master row per (course name × duration) pair.
  // ---------------------------------------------------------------------------
  console.log('[seed] inserting course rows (7 courses × 5 durations = 35)…');
  let count = 0;
  for (const courseName of COURSES) {
    for (const d of DURATIONS) {
      await prisma.courseMaster.create({
        data: {
          nameOfCourseAsGroup: courseName,
          courseFee:           new Prisma.Decimal('0.00'),
          status:              'ACTIVE',
          durationId:          durationByLabel[d.label].id,
        },
      });
      count++;
    }
    console.log(`  + ${courseName} → 5 durations`);
  }
  console.log(`[seed] inserted ${count} course rows.`);

  // ---------------------------------------------------------------------------
  // 4. Print final row counts.
  // ---------------------------------------------------------------------------
  const counts = await prisma.$queryRawUnsafe(`
    SELECT 'course_master'             AS t, COUNT(*)::int AS n FROM course_master
    UNION ALL SELECT 'duration_master',     COUNT(*)::int    FROM duration_master
    UNION ALL SELECT 'education_master',    COUNT(*)::int    FROM education_master
    UNION ALL SELECT 'plans',               COUNT(*)::int    FROM plans
    UNION ALL SELECT 'plan_pricing',        COUNT(*)::int    FROM plan_pricing
    UNION ALL SELECT 'enrollments',         COUNT(*)::int    FROM enrollments
    UNION ALL SELECT 'users',               COUNT(*)::int    FROM users
    UNION ALL SELECT 'permissions',         COUNT(*)::int    FROM permissions
    UNION ALL SELECT 'role_permissions',    COUNT(*)::int    FROM role_permissions
    UNION ALL SELECT 'razorpay_configurations', COUNT(*)::int FROM razorpay_configurations
    ORDER BY t;
  `);
  console.log('\n[summary] final row counts:');
  for (const row of counts) {
    console.log(`  ${row.t.padEnd(28)} ${row.n}`);
  }

  // Sanity check on superadmin preservation
  const sa = await prisma.user.findFirst({
    where: { role: 'superadmin', deleted_at: null },
    select: { email: true, role: true },
  });
  console.log(`\n[verify] superadmin: ${sa ? `${sa.email} (${sa.role}) — preserved ✓` : '*** MISSING ***'}`);
}

main()
  .catch((err) => {
    console.error('[error]', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
