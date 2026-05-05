import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';

// Load .env file (only in non-production; production should inject env vars directly)
if (process.env['NODE_ENV'] !== 'production') {
  dotenv.config({ path: path.resolve(process.cwd(), '.env') });
}

const envSchema = z.object({
  // Application
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.string().default('3000').transform(Number),
  API_VERSION: z.string().default('v1'),

  // Database
  DATABASE_URL: z.string().url().min(1),
  DATABASE_POOL_SIZE: z.string().default('10').transform(Number),
  DATABASE_POOL_TIMEOUT: z.string().default('30').transform(Number),

  // Redis
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.string().default('6379').transform(Number),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_DB: z.string().default('0').transform(Number),
  REDIS_CONNECT_TIMEOUT: z.string().default('10000').transform(Number),
  REDIS_COMMAND_TIMEOUT: z.string().default('5000').transform(Number),

  // JWT
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRY: z.string().default('15m'),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_REFRESH_EXPIRY: z.string().default('7d'),

  // Bcrypt
  BCRYPT_SALT_ROUNDS: z.string().default('12').transform(Number),

  // CORS
  CORS_ORIGINS: z.string().default('http://localhost:3000'),

  // Rate limiting
  RATE_LIMIT_WINDOW_MS: z.string().default('900000').transform(Number),
  RATE_LIMIT_MAX_REQUESTS: z.string().default('1000').transform(Number),
  AUTH_RATE_LIMIT_WINDOW_MS: z.string().default('900000').transform(Number),
  AUTH_RATE_LIMIT_MAX_REQUESTS: z.string().default('20').transform(Number),
  SENSITIVE_RATE_LIMIT_WINDOW_MS: z.string().default('3600000').transform(Number),
  SENSITIVE_RATE_LIMIT_MAX_REQUESTS: z.string().default('5').transform(Number),

  // Body limits
  BODY_SIZE_LIMIT: z.string().default('10mb'),

  // Logging
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),
  LOG_PRETTY: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),

  // Caching TTLs
  CACHE_TTL_DEFAULT: z.string().default('300').transform(Number),
  CACHE_TTL_USER: z.string().default('600').transform(Number),
  CACHE_TTL_TENANT: z.string().default('1800').transform(Number),

  // BullMQ
  QUEUE_EMAIL_CONCURRENCY: z.string().default('5').transform(Number),
  QUEUE_REPORT_CONCURRENCY: z.string().default('2').transform(Number),

  // Swagger
  SWAGGER_ENABLED: z
    .string()
    .default('true')
    .transform((v) => v === 'true'),
  SWAGGER_AUTH_ENABLED: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  SWAGGER_USERNAME: z.string().default('admin'),
  SWAGGER_PASSWORD: z.string().default('changeme'),

  // Multi-tenancy
  TENANT_RESOLUTION_STRATEGY: z.enum(['header', 'subdomain']).default('header'),
  TENANT_HEADER_NAME: z.string().default('X-Tenant-Id'),

  // Graceful shutdown
  SHUTDOWN_TIMEOUT_MS: z.string().default('10000').transform(Number),

  // PM2
  PM2_INSTANCES: z.string().default('max'),

  // ── Razorpay ─────────────────────────────────────────────
  RAZORPAY_MODE: z.enum(['test', 'live']).default('test'),
  RAZORPAY_KEY_ID: z.string().default(''),
  RAZORPAY_KEY_SECRET: z.string().default(''),
  RAZORPAY_WEBHOOK_SECRET: z.string().default(''),

  // ── Cron / Queue feature flags ────────────────────────────
  CRON_ENABLED: z
    .string()
    .default('true')
    .transform((v) => v === 'true'),
  QUEUE_ENABLED: z
    .string()
    .default('true')
    .transform((v) => v === 'true'),

  // ── Payment settings ──────────────────────────────────────
  // Minutes before a pending payment expires
  PAYMENT_TIMEOUT_MIN: z.string().default('15').transform(Number),
  // Maximum retries for payment reconciliation
  MAX_RETRY: z.string().default('3').transform(Number),
  // Default enrollment fee charged on the public marketing flow.
  // Razorpay expects amounts in the smallest currency unit (paise for INR).
  ENROLLMENT_FEE_PAISE: z.string().default('50000').transform(Number),
  ENROLLMENT_FEE_CURRENCY: z.string().length(3).default('INR'),

  // ── External API ──────────────────────────────────────────
  // Maximum retries for external API calls
  API_RETRY_LIMIT: z.string().default('5').transform(Number),
  EXTERNAL_API_URL: z.string().default(''),
  EXTERNAL_API_TOKEN: z.string().default(''),
  // Timeout for external API calls in milliseconds
  EXTERNAL_API_TIMEOUT_MS: z.string().default('10000').transform(Number),

  // ── Config Encryption ─────────────────────────────────────
  // 64 hex chars = 32 bytes key for AES-256-GCM encryption of secrets at rest
  // Generate: openssl rand -hex 32
  CONFIG_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'CONFIG_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)')
    .default('0000000000000000000000000000000000000000000000000000000000000000'),
});

export type Env = z.infer<typeof envSchema>;

function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const errors = result.error.flatten().fieldErrors;
    const missing = Object.entries(errors)
      .map(([key, msgs]) => `  ${key}: ${msgs?.join(', ')}`)
      .join('\n');
    throw new Error(`Invalid environment variables:\n${missing}`);
  }
  return result.data;
}

export const env = validateEnv();
