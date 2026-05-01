import { PrismaClient } from '@prisma/client';
import { env } from './env';
import { logger } from './logger';

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

function createPrismaClient(): PrismaClient {
  const client = new PrismaClient({
    datasources: {
      db: {
        url: env.DATABASE_URL,
      },
    },
    log:
      env.NODE_ENV === 'development'
        ? [
            { level: 'query', emit: 'event' },
            { level: 'error', emit: 'stdout' },
            { level: 'warn', emit: 'stdout' },
          ]
        : [
            { level: 'error', emit: 'stdout' },
            { level: 'warn', emit: 'stdout' },
          ],
  });

  if (env.NODE_ENV === 'development') {
    // Log slow queries in development
    (client as unknown as { $on: (event: string, cb: (e: { query: string; duration: number }) => void) => void }).$on('query', (e) => {
      if (e.duration > 200) {
        logger.warn({ query: e.query, duration: e.duration }, 'Slow query detected');
      }
    });
  }

  return client;
}

// Singleton pattern — reuse across hot reloads in development
export const prisma: PrismaClient =
  env.NODE_ENV === 'production' ? createPrismaClient() : (global.__prisma ??= createPrismaClient());

export async function connectDatabase(): Promise<void> {
  await prisma.$connect();
  logger.info('Database connected');
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
  logger.info('Database disconnected');
}
