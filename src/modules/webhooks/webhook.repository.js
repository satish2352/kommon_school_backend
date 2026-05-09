'use strict';

const { getPrismaClient } = require('../../config/database');

function getDb() {
  return getPrismaClient();
}

/**
 * Paginated list of webhook deliveries.
 * @param {{ skip: number, take: number, where: object, orderBy: object }} opts
 * @returns {Promise<{ rows: object[], total: number }>}
 */
async function findDeliveries({ skip, take, where, orderBy }) {
  const [rows, total] = await getDb().$transaction([
    getDb().webhookDelivery.findMany({ skip, take, where, orderBy }),
    getDb().webhookDelivery.count({ where }),
  ]);
  return { rows, total };
}

/**
 * Find a single delivery by integer PK.
 * @param {number} id
 * @returns {Promise<object|null>}
 */
async function findDeliveryById(id) {
  return getDb().webhookDelivery.findUnique({ where: { id } });
}

/**
 * Insert a new delivery record.
 * @param {object} data
 * @returns {Promise<object>}
 */
async function createDelivery(data) {
  return getDb().webhookDelivery.create({ data });
}

/**
 * Aggregation counts for the stats endpoint.
 * @returns {Promise<{ total, successful, failed, networkError, last24h, last7d }>}
 */
async function getCounts() {
  const db = getDb();
  const now = Date.now();
  const [total, successful, failed, networkError, last24h, last7d] = await db.$transaction([
    db.webhookDelivery.count(),
    db.webhookDelivery.count({ where: { ok: true } }),
    db.webhookDelivery.count({ where: { ok: false, responseStatus: { not: null } } }),
    db.webhookDelivery.count({ where: { ok: false, responseStatus: null } }),
    db.webhookDelivery.count({ where: { sentAt: { gte: new Date(now - 24 * 60 * 60 * 1000) } } }),
    db.webhookDelivery.count({ where: { sentAt: { gte: new Date(now - 7 * 24 * 60 * 60 * 1000) } } }),
  ]);
  return { total, successful, failed, networkError, last24h, last7d };
}

module.exports = { findDeliveries, findDeliveryById, createDelivery, getCounts };
