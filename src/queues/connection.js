'use strict';

const { getRedis } = require('../config/redis');

/**
 * Returns the ioredis instance configured for BullMQ.
 *
 * BullMQ requires `maxRetriesPerRequest: null` on the connection so that
 * blocking commands (BRPOP / BLMOVE) do not hit the ioredis 3-attempt
 * default and throw. This is already set in getRedis().
 *
 * BullMQ v5 expects either a raw IORedis instance OR a connection-options
 * object (with `host`, `port`, etc). The legacy `{ client: ... }` shape was
 * from BullMQ v3 — when passed to v5, BullMQ does not recognise it and
 * falls back to defaults (localhost:6379) when duplicating the connection
 * for blocking commands. Returning the IORedis instance directly fixes the
 * "connect ECONNREFUSED 127.0.0.1:6379" noise from worker.on('error').
 */
function getQueueConnection() {
  return getRedis();
}

module.exports = { getQueueConnection };
