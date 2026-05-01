/**
 * Razorpay Webhook Handler
 *
 * Strategy:
 * 1. Verify HMAC signature (< 1ms)
 * 2. Store raw event with uniqueness constraint (provider, eventId)
 * 3. Return 200 immediately
 * 4. Enqueue heavy processing to BullMQ (with distributed lock)
 *
 * This handler must complete in < 2s to avoid Razorpay retries.
 */

import { Request, Response } from 'express';
import { asyncHandler } from '@/utils/asyncHandler';
import { verifyWebhookSignature, hashBuffer } from '@/utils/razorpay';
import { prisma } from '@/config/database';
import { logger } from '@/config/logger';
import { paymentReconciliationQueue } from '@/jobs/queues';

// ── Event types we handle ────────────────────────────────────────────────────

const HANDLED_EVENTS = new Set([
  'payment.captured',
  'payment.failed',
  'payment.authorized',
  'refund.created',
  'refund.processed',
  'order.paid',
]);

// POST /api/v1/payments/webhook
// Must be registered BEFORE express.json() to preserve raw body.
// The router applies express.raw() before this handler.
export const handleWebhook = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const rawBody: Buffer = req.body as unknown as Buffer;
  const signature = req.headers['x-razorpay-signature'];

  if (!rawBody || !signature || typeof signature !== 'string') {
    logger.warn({ path: req.path }, 'Webhook missing body or signature');
    res.status(400).json({ error: 'Missing signature or body' });
    return;
  }

  // 1. Verify signature — fast, synchronous HMAC
  const tenantId = req.tenant?.id ?? null;
  const isValid = await verifyWebhookSignature(rawBody, signature, tenantId);

  if (!isValid) {
    logger.warn({ signature }, 'Webhook signature verification failed');
    // Return 200 to prevent Razorpay retries on our auth failure
    res.status(200).json({ status: 'signature_invalid' });
    return;
  }

  // 2. Parse payload
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>;
  } catch {
    logger.warn('Webhook payload is not valid JSON');
    res.status(400).json({ error: 'Invalid JSON payload' });
    return;
  }

  const eventId = payload['id'] as string | undefined;
  const eventType = payload['event'] as string | undefined;

  if (!eventId || !eventType) {
    logger.warn({ payload }, 'Webhook missing event id or type');
    res.status(200).json({ status: 'ignored' });
    return;
  }

  // 3. Skip unknown event types
  if (!HANDLED_EVENTS.has(eventType)) {
    logger.debug({ eventType }, 'Webhook event type not handled — ignoring');
    res.status(200).json({ status: 'ignored' });
    return;
  }

  // 4. Compute payload hash for integrity
  const payloadHash = hashBuffer(rawBody);

  // 5. Resolve internal payment ID from payload
  let razorpayPaymentId: string | null = null;
  let razorpayOrderId: string | null = null;

  try {
    const paymentEntity = (payload['payload'] as Record<string, unknown>)?.['payment'] as
      | Record<string, unknown>
      | undefined;
    const orderEntity = (payload['payload'] as Record<string, unknown>)?.['order'] as
      | Record<string, unknown>
      | undefined;

    const entity = (paymentEntity?.['entity'] as Record<string, unknown>) ?? {};
    const orderData = (orderEntity?.['entity'] as Record<string, unknown>) ?? {};

    razorpayPaymentId = (entity['id'] as string) ?? null;
    razorpayOrderId = (entity['order_id'] as string) ?? (orderData['id'] as string) ?? null;
  } catch {
    logger.warn({ eventType }, 'Could not extract payment/order IDs from webhook payload');
  }

  // 6. Find internal payment record
  let internalPaymentId: string | null = null;
  if (razorpayOrderId) {
    const payment = await prisma.payment.findUnique({
      where: { razorpayOrderId },
      select: { id: true },
    });
    internalPaymentId = payment?.id ?? null;
  }

  // 7. Store event with unique constraint — prevents duplicate processing
  try {
    await prisma.webhookEvent.upsert({
      where: { provider_eventId: { provider: 'razorpay', eventId } },
      create: {
        provider: 'razorpay',
        eventId,
        eventType,
        paymentId: internalPaymentId ?? undefined,
        rawPayload: payload as unknown as import('@prisma/client').Prisma.InputJsonValue,
        payloadHash,
        processed: false,
      },
      update: {
        // If it already exists and is not processed, update payload hash
        // (handles Razorpay retrying with slightly different payload)
        retryCount: { increment: 1 },
        updatedAt: new Date(),
      },
    });
  } catch (err) {
    // P2002 = unique violation → event already exists and was processed
    logger.info({ eventId, eventType }, 'Webhook event already stored — skipping enqueue');
    res.status(200).json({ status: 'already_processed' });
    return;
  }

  // 8. Enqueue async processing — webhook handler must be fast
  try {
    if (paymentReconciliationQueue) {
      await paymentReconciliationQueue.add(
        'webhook',
        {
          webhookEventId: eventId,
          eventType,
          internalPaymentId,
          razorpayPaymentId,
          razorpayOrderId,
          payload,
        },
        {
          jobId: `webhook:${eventId}`, // deduplicate BullMQ job
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
        },
      );
    }
  } catch (err) {
    logger.error({ err, eventId }, 'Failed to enqueue webhook job — will be reconciled by cron');
    // Don't fail the webhook — Razorpay may retry and the cron will reconcile
  }

  logger.info({ eventId, eventType, internalPaymentId }, 'Webhook received and enqueued');

  // 9. Return 200 immediately
  res.status(200).json({ status: 'accepted' });
});
