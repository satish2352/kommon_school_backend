import { Queue } from 'bullmq';
import { env } from '@/config/env';
import { logger } from '@/config/logger';

// BullMQ connection uses direct host/port config (not a client instance)
const connection = {
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  ...(env.REDIS_PASSWORD ? { password: env.REDIS_PASSWORD } : {}),
  db: env.REDIS_DB,
};

// ── Payment Reconciliation Queue ─────────────────────────

export interface PaymentReconciliationJobData {
  webhookEventId: string;
  eventType: string;
  internalPaymentId: string | null;
  razorpayPaymentId: string | null;
  razorpayOrderId: string | null;
  payload: Record<string, unknown>;
}

export const paymentReconciliationQueue = new Queue<PaymentReconciliationJobData>(
  'payment-reconciliation',
  {
    connection,
    defaultJobOptions: {
      attempts: env.MAX_RETRY,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
      removeOnComplete: { count: 200 },
      removeOnFail: { count: 1000 },
    },
  },
);

// ── Email Queue ───────────────────────────────────────────
export interface EmailJobData {
  to: string;
  subject: string;
  template: string;
  context: Record<string, unknown>;
  tenantId?: string;
}

export const emailQueue = new Queue<EmailJobData>('email', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 500 },
  },
});

// ── Report Queue ─────────────────────────────────────────
export interface ReportJobData {
  reportType: string;
  tenantId: string;
  userId: string;
  params: Record<string, unknown>;
}

export const reportQueue = new Queue<ReportJobData>('report', {
  connection,
  defaultJobOptions: {
    attempts: 2,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: { count: 50 },
    removeOnFail: { count: 100 },
  },
});

// ── Payment Cron Queue ────────────────────────────────────
// Handles: payment-recovery, payment-reconciliation, payment-expiry

export interface PaymentCronJobData {
  correlationId: string;
}

export const paymentCronQueue = new Queue<PaymentCronJobData>('payment-cron', {
  connection,
  defaultJobOptions: {
    attempts: 1, // Cron jobs are not retried — next run will pick up where this left off
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 500 },
  },
});

// ── External API Cron Queue ───────────────────────────────
// Handles: external-api-retry, dlq-processor, and ad-hoc sync triggers

export interface ExternalApiCronJobData {
  correlationId?: string;
  logId?: string; // for targeted retry of a specific ExternalApiLog
}

export const externalApiCronQueue = new Queue<ExternalApiCronJobData>('external-api-cron', {
  connection,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 500 },
  },
});

// ── Follow-up Cron Queue ──────────────────────────────────
// Handles: follow-up-reminder, stale-leads, auto-close

export interface FollowUpCronJobData {
  correlationId: string;
}

export const followUpCronQueue = new Queue<FollowUpCronJobData>('followup-cron', {
  connection,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 500 },
  },
});

// ── Queue health check ────────────────────────────────────
export async function closeQueues(): Promise<void> {
  try {
    await emailQueue.close();
    await reportQueue.close();
    await paymentReconciliationQueue.close();
    await paymentCronQueue.close();
    await externalApiCronQueue.close();
    await followUpCronQueue.close();
    logger.info('BullMQ queues closed');
  } catch (err) {
    logger.error({ err }, 'Error closing BullMQ queues');
  }
}
