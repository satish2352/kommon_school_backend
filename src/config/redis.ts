import Redis from 'ioredis';
import { env } from './env';
import { logger } from './logger';

interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  db: number;
  connectTimeout: number;
  commandTimeout: number;
  maxRetriesPerRequest: number;
  enableReadyCheck: boolean;
  lazyConnect: boolean;
  retryStrategy: (times: number) => number | null;
}

function buildRedisConfig(): RedisConfig {
  return {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    ...(env.REDIS_PASSWORD ? { password: env.REDIS_PASSWORD } : {}),
    db: env.REDIS_DB,
    connectTimeout: env.REDIS_CONNECT_TIMEOUT,
    commandTimeout: env.REDIS_COMMAND_TIMEOUT,
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: true,
    retryStrategy(times: number): number | null {
      if (times > 5) {
        logger.error({ times }, 'Redis retry limit reached');
        return null; // stop retrying
      }
      const delay = Math.min(times * 200, 2000);
      logger.warn({ times, delay }, 'Redis reconnecting...');
      return delay;
    },
  };
}

let redisClient: Redis | null = null;

export function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis(buildRedisConfig());

    redisClient.on('connect', () => logger.info('Redis connected'));
    redisClient.on('ready', () => logger.info('Redis ready'));
    redisClient.on('error', (err) => logger.error({ err }, 'Redis error'));
    redisClient.on('close', () => logger.warn('Redis connection closed'));
    redisClient.on('reconnecting', () => logger.info('Redis reconnecting'));
    redisClient.on('end', () => logger.warn('Redis connection ended'));
  }
  return redisClient;
}

export async function connectRedis(): Promise<void> {
  const client = getRedisClient();
  try {
    await client.connect();
    logger.info('Redis connected successfully');
  } catch (err) {
    logger.error({ err }, 'Redis connection failed — caching and rate limiting will be degraded');
    // Do not throw — allow server to start with degraded functionality
  }
}

export async function disconnectRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    logger.info('Redis disconnected');
  }
}

export async function pingRedis(): Promise<boolean> {
  try {
    const client = getRedisClient();
    const result = await client.ping();
    return result === 'PONG';
  } catch {
    return false;
  }
}
