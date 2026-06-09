// QA helper (one-off): row counts for every table + users grouped by role.
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const tables = [
  'enrollments', 'payments', 'external_api_logs', 'followups', 'followup_notes',
  'webhook_delivery', 'webhook_events', 'email_logs', 'sumago_users', 'audit_logs',
  'plans', 'plan_pricing', 'internal_plans', 'course_master', 'course_name_master',
  'duration_master', 'education_master', 'users', 'refresh_tokens',
  'razorpay_configurations', 'permissions', 'role_permissions',
];
const out = {};
for (const t of tables) {
  try {
    const rows = await p.$queryRawUnsafe(`SELECT COUNT(*)::int AS c FROM "${t}"`);
    out[t] = rows[0].c;
  } catch (e) {
    out[t] = `ERR ${e.message.split('\n')[0]}`;
  }
}
const byRole = await p.$queryRawUnsafe(
  `SELECT role, COUNT(*)::int AS c FROM "users" GROUP BY role ORDER BY role`
);
console.log(JSON.stringify({ counts: out, usersByRole: byRole }, null, 2));
await p.$disconnect();
