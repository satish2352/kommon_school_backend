'use strict';

const { getPrismaClient } = require('../../config/database');

// Singleton settings row lives at id = 1 (seeded by migration). getSettings
// self-heals by creating it if somehow absent, so reads never 404.
async function getSettings() {
  const db = getPrismaClient();
  let row = await db.siteSetting.findUnique({ where: { id: 1 } });
  if (!row) {
    row = await db.siteSetting.create({ data: { id: 1, brandName: 'Kommon School' } });
  }
  return row;
}

async function updateSettings({ brandName, logoUrl }) {
  const db = getPrismaClient();
  await getSettings(); // ensure the row exists
  const data = {};
  if (brandName !== undefined) data.brandName = brandName;
  if (logoUrl !== undefined) data.logoUrl = logoUrl;
  return db.siteSetting.update({ where: { id: 1 }, data });
}

module.exports = { getSettings, updateSettings };
