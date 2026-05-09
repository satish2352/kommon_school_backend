'use strict';

const { getPrismaClient } = require('../../config/database');

function getDb() {
  return getPrismaClient();
}

/**
 * Insert one audit log row.
 * @param {object} data
 * @returns {Promise<object>}
 */
async function createAuditLog(data) {
  return getDb().auditLog.create({ data });
}

/**
 * Paginated list of audit logs with optional eager-loaded actor.
 * @param {{ skip: number, take: number, where: object, orderBy: object }} opts
 * @returns {Promise<{ rows: object[], total: number }>}
 */
async function listAuditLogs({ skip, take, where, orderBy }) {
  const db = getDb();
  const [rows, total] = await db.$transaction([
    db.auditLog.findMany({
      skip,
      take,
      where,
      orderBy,
      include: {
        actor: {
          select: { id: true, email: true, role: true },
        },
      },
    }),
    db.auditLog.count({ where }),
  ]);
  return { rows, total };
}

module.exports = { createAuditLog, listAuditLogs };
