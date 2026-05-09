'use strict';

const { getRedis } = require('../config/redis');

/**
 * Returns the ioredis instance configured for BullMQ.
 *
 * BullMQ requires `maxRetriesPerRequest: null` on the connection so that
 * blocking commands (BRPOP / BLMOVE) do not hit the ioredis 3-attempt
 * default and throw. This is already set in getRedis().
 *
 * Both Queue and Worker accept a `{ client }` option that wraps an existing
 * ioredis instance, avoiding the need to create separate connections for
 * each BullMQ entity (saves file descriptors in high-concurrency deployments).
 */
function getQueueConnection() {
  return { client: getRedis() };
}

module.exports = { getQueueConnection };
