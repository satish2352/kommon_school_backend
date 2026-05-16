'use strict';

const { PrismaClient } = require('@prisma/client');

(async () => {
  const p = new PrismaClient();
  try {
    const rows = await p.$queryRawUnsafe(
      "SELECT indexname, indexdef FROM pg_indexes " +
      "WHERE tablename = 'enrollments' AND indexname LIKE '%email%' " +
      "ORDER BY indexname",
    );
    console.log(JSON.stringify(rows, null, 2));
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exitCode = 1;
  } finally {
    await p.$disconnect();
  }
})();
