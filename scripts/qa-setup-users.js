// QA helper: create dedicated test users (one per role) with a known password.
// Idempotent upsert. Leaves existing real accounts untouched.
const { PrismaClient } = require('@prisma/client');
const { hashPassword } = require('../src/utils/crypto');
const p = new PrismaClient();

const PASSWORD = 'QaTest@12345';
const USERS = [
  { email: 'qa.superadmin@kommontest.com', role: 'superadmin' },
  { email: 'qa.admin@kommontest.com', role: 'admin' },
  { email: 'qa.marketing@kommontest.com', role: 'marketing' },
  { email: 'qa.student@kommontest.com', role: 'student' },
];

(async () => {
  const hash = await hashPassword(PASSWORD);
  for (const u of USERS) {
    const row = await p.user.upsert({
      where: { email: u.email },
      update: { password_hash: hash, role: u.role, deleted_at: null },
      create: { email: u.email, password_hash: hash, role: u.role },
    });
    console.log(`upserted ${row.email} (${row.role})`);
  }
  await p.$disconnect();
})();
