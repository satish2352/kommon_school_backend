'use strict';

const Redis = require('ioredis');
const logger = require('./logger');

let client = null;

/**
 * Returns the shared ioredis singleton.
 *
 * BullMQ blocking commands (BRPOP, BLMOVE, etc.) require
 * `maxRetriesPerRequest: null` — without it ioredis times out
 * after 3 attempts and BullMQ throws an unhandled error.
 *
 * `enableReadyCheck: false` allows BullMQ to queue commands
 * while Redis is still loading its dataset on startup.
 */
function getRedis() {
  if (!client) {
    const url = process.env.REDIS_URL;
    if (!url) {
      throw new Error('REDIS_URL env var is not set. Cannot create Redis connection.');
    }

    client = new Redis(url, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: false,
      // Reconnect strategy: exponential backoff, cap at 30 s, give up after 10 failed attempts
      retryStrategy(times) {
        if (times > 10) {
          logger.error({ msg: 'redis_retry_exhausted', attempts: times });
          return null; // stop retrying
        }
        const delay = Math.min(100 * Math.pow(2, times), 30000);
        logger.warn({ msg: 'redis_reconnecting', attempt: times, delay_ms: delay });
        return delay;
      },
    });

    client.on('connect', () => logger.info({ msg: 'redis_connected' }));
    client.on('ready', () => logger.info({ msg: 'redis_ready' }));
    client.on('error', (err) => logger.error({ msg: 'redis_error', error: err.message }));
    client.on('close', () => logger.warn({ msg: 'redis_connection_closed' }));
    client.on('reconnecting', () => logger.warn({ msg: 'redis_reconnecting_event' }));
    client.on('end', () => logger.warn({ msg: 'redis_connection_ended' }));
  }

  return client;
}

async function disconnectRedis() {
  if (client) {
    try {
      await client.quit();
      logger.info({ msg: 'redis_disconnected' });
    } catch (err) {
      logger.error({ msg: 'redis_disconnect_error', error: err.message });
      client.disconnect();
    } finally {
      client = null;
    }
  }
}

module.exports = { getRedis, disconnectRedis };
