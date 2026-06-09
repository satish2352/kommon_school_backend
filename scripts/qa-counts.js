// QA helper: print row counts for all enrollment-related tables.
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const tables = [
  'enrollments', 'payments', 'external_api_logs', 'followups', 'followup_notes',
  'webhook_delivery', 'webhook_events', 'email_logs', 'sumago_users', 'audit_logs',
  'plans', 'plan_pricing', 'internal_plans', 'users', 'razorpay_configurations',
];
const out = {};
for (const t of tables) {
  try {
    const r = await prisma_count(t);
    out[t] = r;
  } catch (e) {
    out[t] = `ERR ${e.message.split('\n')[0]}`;
  }
}
async function prisma_count(t) {
  const rows = await p.$queryRawUnsafe(`SELECT COUNT(*)::int AS c FROM "${t}"`);
  return rows[0].c;
}
console.log(JSON.stringify(out, null, 2));
await p.$disconnect();
