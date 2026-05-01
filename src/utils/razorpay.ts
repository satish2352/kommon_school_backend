/**
 * Razorpay SDK wrapper.
 *
 * We wrap the Razorpay SDK rather than importing it directly so that:
 * 1. We can swap the active config per-request (multi-tenant key support)
 * 2. We can mock it in tests without patching node_modules
 * 3. We keep credential access in one place (never logged)
 */

import crypto from 'crypto';
import { env } from '@/config/env';
import { logger } from '@/config/logger';
import { prisma } from '@/config/database';
import { cacheGetOrSet, cacheDelete, buildCacheKey } from '@/utils/cache';
import { decrypt } from '@/utils/encryption';

// Cache TTL for active Razorpay config (60 seconds)
const RAZORPAY_CONFIG_CACHE_TTL = 60;

// Lazy-require Razorpay to prevent startup crash when package is absent
// (package.json must list razorpay as a dep; install it separately)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let RazorpayLib: any = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getRazorpayLib(): any {
  if (!RazorpayLib) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      RazorpayLib = require('razorpay');
    } catch {
      throw new Error('razorpay npm package not installed. Run: npm install razorpay');
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return RazorpayLib;
}

export interface RazorpayOrderCreateParams {
  amount: number;      // paise
  currency: string;    // e.g. "INR"
  receipt: string;
  notes?: Record<string, string>;
}

export interface RazorpayOrderResponse {
  id: string;
  amount: number;
  currency: string;
  receipt: string;
  status: string;
  created_at: number;
}

export interface RazorpayPaymentFetchResponse {
  id: string;
  entity: string;
  amount: number;
  currency: string;
  status: string; // 'created' | 'authorized' | 'captured' | 'refunded' | 'failed'
  order_id: string;
  captured: boolean;
  description: string;
  bank: string | null;
  wallet: string | null;
  vpa: string | null;
  email: string;
  contact: string;
  error_code: string | null;
  error_description: string | null;
  created_at: number;
}

export interface RazorpayRefundResponse {
  id: string;
  entity: string;
  amount: number;
  currency: string;
  payment_id: string;
  notes: Record<string, string>;
  status: string;
  created_at: number;
}

/**
 * Resolve the active Razorpay credentials.
 * Precedence: DB active config (Redis-cached, TTL=60s) → env vars.
 *
 * Secrets stored in DB are AES-256-GCM encrypted and decrypted here.
 * Env var fallback uses plaintext values directly.
 */
async function resolveCredentials(tenantId?: string | null): Promise<{
  keyId: string;
  keySecret: string;
  webhookSecret: string;
}> {
  try {
    const cacheKey = buildCacheKey(
      'razorpay:config:active',
      tenantId ?? 'global',
    );

    const config = await cacheGetOrSet(
      cacheKey,
      () =>
        prisma.razorpayConfig.findFirst({
          where: {
            isActive: true,
            ...(tenantId ? { tenantId } : {}),
          },
          select: { keyId: true, keySecret: true, webhookSecret: true },
        }),
      RAZORPAY_CONFIG_CACHE_TTL,
    );

    if (config && config.keyId && config.keySecret) {
      // Decrypt secrets (they are stored encrypted via AES-256-GCM)
      let keySecret: string;
      let webhookSecret: string;
      try {
        keySecret = decrypt(config.keySecret);
        webhookSecret = decrypt(config.webhookSecret);
      } catch {
        // Fallback: treat as plaintext (for configs created before encryption was added)
        keySecret = config.keySecret;
        webhookSecret = config.webhookSecret;
      }

      return {
        keyId: config.keyId,
        keySecret,
        webhookSecret,
      };
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to load Razorpay config from DB, falling back to env');
  }

  return {
    keyId: env.RAZORPAY_KEY_ID,
    keySecret: env.RAZORPAY_KEY_SECRET,
    webhookSecret: env.RAZORPAY_WEBHOOK_SECRET,
  };
}

/**
 * Invalidate the cached active Razorpay config for a tenant (or global).
 * Call this after activating a new config.
 */
export async function invalidateRazorpayConfigCache(tenantId?: string | null): Promise<void> {
  const cacheKey = buildCacheKey('razorpay:config:active', tenantId ?? 'global');
  await cacheDelete(cacheKey);
}

/**
 * Create a Razorpay order.
 */
export async function createRazorpayOrder(
  params: RazorpayOrderCreateParams,
  tenantId?: string | null,
): Promise<RazorpayOrderResponse> {
  const { keyId, keySecret } = await resolveCredentials(tenantId);

  if (!keyId || !keySecret) {
    throw new Error('Razorpay credentials not configured');
  }

  const Razorpay = getRazorpayLib();
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  const rzp = new Razorpay({ key_id: keyId, key_secret: keySecret }) as Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>>;

  logger.debug({ amount: params.amount, currency: params.currency }, 'Creating Razorpay order');

  const order = await rzp['orders']['create'](params) as RazorpayOrderResponse;
  return order;
}

/**
 * Fetch payment details from Razorpay.
 */
export async function fetchRazorpayPayment(
  razorpayPaymentId: string,
  tenantId?: string | null,
): Promise<RazorpayPaymentFetchResponse> {
  const { keyId, keySecret } = await resolveCredentials(tenantId);

  const Razorpay = getRazorpayLib();
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  const rzp = new Razorpay({ key_id: keyId, key_secret: keySecret }) as Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>>;

  return rzp['payments']['fetch'](razorpayPaymentId) as Promise<RazorpayPaymentFetchResponse>;
}

/**
 * Create a refund on Razorpay.
 */
export async function createRazorpayRefund(
  razorpayPaymentId: string,
  amount?: number, // paise; undefined = full refund
  notes?: Record<string, string>,
  tenantId?: string | null,
): Promise<RazorpayRefundResponse> {
  const { keyId, keySecret } = await resolveCredentials(tenantId);

  const Razorpay = getRazorpayLib();
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  const rzp = new Razorpay({ key_id: keyId, key_secret: keySecret }) as Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>>;

  const payload: Record<string, unknown> = { notes: notes ?? {} };
  if (amount !== undefined) {
    payload['amount'] = amount;
  }

  return rzp['payments']['refund'](razorpayPaymentId, payload) as Promise<RazorpayRefundResponse>;
}

/**
 * Verify Razorpay webhook signature.
 * Returns true if valid, false otherwise.
 *
 * Algorithm: HMAC-SHA256(rawBody, webhookSecret) compared to X-Razorpay-Signature header.
 */
export async function verifyWebhookSignature(
  rawBody: Buffer,
  signature: string,
  tenantId?: string | null,
): Promise<boolean> {
  const { webhookSecret } = await resolveCredentials(tenantId);

  if (!webhookSecret) {
    logger.error('RAZORPAY_WEBHOOK_SECRET not configured — refusing webhook');
    return false;
  }

  try {
    const expectedSig = crypto
      .createHmac('sha256', webhookSecret)
      .update(rawBody)
      .digest('hex');

    // Constant-time comparison
    return crypto.timingSafeEqual(Buffer.from(expectedSig, 'hex'), Buffer.from(signature, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Verify Razorpay payment signature (client-side payment).
 * Algorithm: HMAC-SHA256(orderId + "|" + paymentId, keySecret)
 */
export async function verifyPaymentSignature(
  razorpayOrderId: string,
  razorpayPaymentId: string,
  razorpaySignature: string,
  tenantId?: string | null,
): Promise<boolean> {
  const { keySecret } = await resolveCredentials(tenantId);

  if (!keySecret) {
    return false;
  }

  try {
    const body = razorpayOrderId + '|' + razorpayPaymentId;
    const expectedSig = crypto
      .createHmac('sha256', keySecret)
      .update(body)
      .digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(expectedSig, 'hex'),
      Buffer.from(razorpaySignature, 'hex'),
    );
  } catch {
    return false;
  }
}

/**
 * Generate SHA-256 hash of a buffer (for webhook integrity storage).
 */
export function hashBuffer(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * Get webhook secret (for resolving from DB or env).
 */
export async function getWebhookSecret(tenantId?: string | null): Promise<string> {
  const { webhookSecret } = await resolveCredentials(tenantId);
  return webhookSecret;
}
