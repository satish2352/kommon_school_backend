import { Worker, Job } from 'bullmq';
import { logger } from '@/config/logger';
import { env } from '@/config/env';
import { withLock } from '@/utils/distributedLock';
import type {
  EmailJobData,
  ReportJobData,
  PaymentReconciliationJobData,
  PaymentCronJobData,
  ExternalApiCronJobData,
  FollowUpCronJobData,
} from './queues';

// BullMQ connection uses direct host/port config (not a client instance)
const connection = {
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  ...(env.REDIS_PASSWORD ? { password: env.REDIS_PASSWORD } : {}),
  db: env.REDIS_DB,
};

// ── Email Worker ─────────────────────────────────────────
async function processEmailJob(job: Job<EmailJobData>): Promise<void> {
  logger.info({ jobId: job.id, to: job.data.to, subject: job.data.subject }, 'Processing email job');

  // TODO: integrate with an email provider (e.g. Resend, SendGrid, SES)
  // For now, simulate processing
  await new Promise((resolve) => setTimeout(resolve, 100));

  logger.info({ jobId: job.id }, 'Email job completed');
}

// ── Report Worker ────────────────────────────────────────
async function processReportJob(job: Job<ReportJobData>): Promise<void> {
  logger.info(
    { jobId: job.id, reportType: job.data.reportType, tenantId: job.data.tenantId },
    'Processing report job',
  );

  // TODO: implement report generation
  await new Promise((resolve) => setTimeout(resolve, 500));

  logger.info({ jobId: job.id }, 'Report job completed');
}

// ── Payment Reconciliation Worker (webhook events) ────────
async function processPaymentReconciliationJob(
  job: Job<PaymentReconciliationJobData>,
): Promise<void> {
  const { webhookEventId, eventType, internalPaymentId, razorpayPaymentId, razorpayOrderId, payload } =
    job.data;

  logger.info(
    { jobId: job.id, webhookEventId, eventType, internalPaymentId },
    'Processing payment reconciliation job',
  );

  // Use distributed lock to prevent double-processing across instances
  const lockKey = `lock:webhook:${webhookEventId}`;
  await withLock(lockKey, 30_000, async () => {
    const { prisma } = await import('@/config/database');

    // Check if already processed
    const event = await prisma.webhookEvent.findUnique({
      where: { provider_eventId: { provider: 'razorpay', eventId: webhookEventId } },
    });

    if (event?.processed) {
      logger.info({ webhookEventId }, 'Webhook event already processed — skipping');
      return;
    }

    try {
      // Delegate to payments service for business logic
      const { paymentsRepository } = await import('@/modules/payments/payments.repository');
      const { paymentsService } = await import('@/modules/payments/payments.service');

      if (eventType === 'payment.captured' || eventType === 'order.paid') {
        if (internalPaymentId && razorpayPaymentId) {
          await paymentsRepository.markSuccess(
            internalPaymentId,
            razorpayPaymentId,
            '',
            // Amount from payload
            ((
              (payload['payload'] as Record<string, unknown>)?.['payment'] as Record<string, unknown>
            )?.['entity'] as Record<string, unknown>)?.['amount'] as number ?? 0,
          );

          // Enqueue external API sync
          if (env.QUEUE_ENABLED) {
            const { externalApiCronQueue } = await import('./queues');
            await externalApiCronQueue.add(
              'sync-payment',
              { logId: internalPaymentId, correlationId: `webhook:${webhookEventId}` },
              { attempts: 1 },
            );
          }
        }
      } else if (eventType === 'payment.failed') {
        if (internalPaymentId) {
          await paymentsRepository.markFailed(
            internalPaymentId,
            'PAYMENT_FAILED',
            'Payment failed via Razorpay webhook',
            'webhook',
          );
        }
      }

      void paymentsService; // satisfy noUnusedLocals if present

      // Mark event processed
      await prisma.webhookEvent.update({
        where: { provider_eventId: { provider: 'razorpay', eventId: webhookEventId } },
        data: { processed: true, processedAt: new Date() },
      });

      logger.info({ webhookEventId, eventType }, 'Webhook event processed');
    } catch (err) {
      logger.error({ err, webhookEventId, eventType }, 'Failed to process webhook event');

      await prisma.webhookEvent.update({
        where: { provider_eventId: { provider: 'razorpay', eventId: webhookEventId } },
        data: {
          error: String(err),
          retryCount: { increment: 1 },
        },
      }).catch(() => {
        // ignore update failure
      });

      throw err; // re-throw so BullMQ retries
    }
  });
}

// ── Payment Cron Worker ──────────────────────────────────
async function processPaymentCronJob(job: Job<PaymentCronJobData>): Promise<void> {
  const { correlationId } = job.data;
  const jobName = job.name;

  logger.info({ jobId: job.id, jobName, correlationId }, 'Processing payment cron job');

  const lockKey = `lock:cron:${jobName}`;
  const lockTtl = 4 * 60 * 1000; // 4 minutes — less than the shortest cron interval (5 min)

  await withLock(lockKey, lockTtl, async () => {
    const { paymentsService } = await import('@/modules/payments/payments.service');

    switch (jobName) {
      case 'payment-recovery': {
        const count = await paymentsService.recoverPendingPayments(correlationId);
        logger.info({ jobName, correlationId, recovered: count }, 'Payment cron job complete');
        break;
      }
      case 'payment-reconciliation': {
        const count = await paymentsService.reconcileWithRazorpay(correlationId);
        logger.info({ jobName, correlationId, reconciled: count }, 'Payment cron job complete');
        break;
      }
      case 'payment-expiry': {
        const count = await paymentsService.expireStalePayments(correlationId);
        logger.info({ jobName, correlationId, expired: count }, 'Payment cron job complete');
        break;
      }
      default:
        logger.warn({ jobName }, 'Unknown payment cron job name');
    }
  });
}

// ── External API Cron Worker ──────────────────────────────
async function processExternalApiCronJob(job: Job<ExternalApiCronJobData>): Promise<void> {
  const { correlationId, logId } = job.data;
  const jobName = job.name;

  logger.info({ jobId: job.id, jobName, correlationId, logId }, 'Processing external API cron job');

  // Ad-hoc sync trigger (from webhook handler) — bypass cron lock
  if (jobName === 'sync-payment' && logId) {
    const { syncUserAfterPayment } = await import('@/modules/externalApi/externalApi.service');
    await syncUserAfterPayment(logId);
    return;
  }

  const lockKey = `lock:cron:${jobName}`;
  const lockTtl = 10 * 60 * 1000; // 10 minutes

  await withLock(lockKey, lockTtl, async () => {
    const { externalApiRepository } = await import(
      '@/modules/externalApi/externalApi.repository'
    );
    const { retryExternalApiLog } = await import(
      '@/modules/externalApi/externalApi.service'
    );

    switch (jobName) {
      case 'external-api-retry': {
        const eligible = await externalApiRepository.findRetryEligible(
          env.API_RETRY_LIMIT,
          new Date(),
        );

        logger.info(
          { correlationId, count: eligible.length },
          'external-api-retry: found eligible records',
        );

        let succeeded = 0;
        for (const record of eligible) {
          const ok = await retryExternalApiLog(record.id);
          if (ok) succeeded++;
        }

        logger.info(
          { correlationId, processed: eligible.length, succeeded },
          'external-api-retry: complete',
        );
        break;
      }

      case 'dlq-processor': {
        const deadLetters = await externalApiRepository.findDeadLetterEligible(
          env.API_RETRY_LIMIT,
        );

        logger.info(
          { correlationId, count: deadLetters.length },
          'dlq-processor: scanning dead letter queue',
        );

        for (const record of deadLetters) {
          logger.error(
            {
              logId: record.id,
              paymentId: record.paymentId,
              enrollmentId: record.enrollmentId,
              error: record.error,
              retryCount: record.retryCount,
              correlationId,
            },
            'dlq-processor: permanent failure — requires ops intervention',
          );
          // Mark as DEAD_LETTER if not already
          await externalApiRepository.markDeadLetter(record.id).catch(() => {});
        }

        logger.info({ correlationId, surfaced: deadLetters.length }, 'dlq-processor: complete');
        break;
      }

      default:
        logger.warn({ jobName }, 'Unknown external API cron job name');
    }
  });
}

// ── Follow-up Cron Worker ─────────────────────────────────
async function processFollowUpCronJob(job: Job<FollowUpCronJobData>): Promise<void> {
  const { correlationId } = job.data;
  const jobName = job.name;

  logger.info({ jobId: job.id, jobName, correlationId }, 'Processing follow-up cron job');

  const lockKey = `lock:cron:${jobName}`;
  const lockTtl = 8 * 60 * 1000; // 8 minutes

  await withLock(lockKey, lockTtl, async () => {
    const { followUpsService } = await import('@/modules/followups/followups.service');

    switch (jobName) {
      case 'follow-up-reminder': {
        const count = await followUpsService.markDueReminders(correlationId);
        logger.info({ jobName, correlationId, count }, 'Follow-up cron job complete');
        break;
      }
      case 'stale-leads': {
        const count = await followUpsService.markStaleLeads(correlationId);
        logger.info({ jobName, correlationId, count }, 'Follow-up cron job complete');
        break;
      }
      case 'auto-close': {
        const count = await followUpsService.autoCloseUninterested(correlationId);
        logger.info({ jobName, correlationId, count }, 'Follow-up cron job complete');
        break;
      }
      default:
        logger.warn({ jobName }, 'Unknown follow-up cron job name');
    }
  });
}

// ── Worker instances ──────────────────────────────────────

let emailWorker: Worker<EmailJobData> | null = null;
let reportWorker: Worker<ReportJobData> | null = null;
let paymentReconciliationWorker: Worker<PaymentReconciliationJobData> | null = null;
let paymentCronWorker: Worker<PaymentCronJobData> | null = null;
let externalApiCronWorker: Worker<ExternalApiCronJobData> | null = null;
let followUpCronWorker: Worker<FollowUpCronJobData> | null = null;

export function startWorkers(): void {
  if (!env.QUEUE_ENABLED) {
    logger.info('QUEUE_ENABLED=false — workers not started');
    return;
  }

  // Email worker
  emailWorker = new Worker<EmailJobData>('email', processEmailJob, {
    connection,
    concurrency: env.QUEUE_EMAIL_CONCURRENCY,
  });
  emailWorker.on('completed', (job) => {
    logger.debug({ jobId: job.id }, 'Email job completed');
  });
  emailWorker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Email job failed');
  });

  // Report worker
  reportWorker = new Worker<ReportJobData>('report', processReportJob, {
    connection,
    concurrency: env.QUEUE_REPORT_CONCURRENCY,
  });
  reportWorker.on('completed', (job) => {
    logger.debug({ jobId: job.id }, 'Report job completed');
  });
  reportWorker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Report job failed');
  });

  // Payment reconciliation worker (webhook events)
  paymentReconciliationWorker = new Worker<PaymentReconciliationJobData>(
    'payment-reconciliation',
    processPaymentReconciliationJob,
    { connection, concurrency: 5 },
  );
  paymentReconciliationWorker.on('completed', (job) => {
    logger.debug({ jobId: job.id }, 'Payment reconciliation job completed');
  });
  paymentReconciliationWorker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Payment reconciliation job failed');
  });

  // Payment cron worker
  paymentCronWorker = new Worker<PaymentCronJobData>(
    'payment-cron',
    processPaymentCronJob,
    { connection, concurrency: 1 }, // single concurrency — cron jobs must not overlap
  );
  paymentCronWorker.on('completed', (job) => {
    logger.debug({ jobId: job.id, jobName: job.name }, 'Payment cron job completed');
  });
  paymentCronWorker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, jobName: job?.name, err }, 'Payment cron job failed');
  });

  // External API cron worker
  externalApiCronWorker = new Worker<ExternalApiCronJobData>(
    'external-api-cron',
    processExternalApiCronJob,
    { connection, concurrency: 2 },
  );
  externalApiCronWorker.on('completed', (job) => {
    logger.debug({ jobId: job.id, jobName: job.name }, 'External API cron job completed');
  });
  externalApiCronWorker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, jobName: job?.name, err }, 'External API cron job failed');
  });

  // Follow-up cron worker
  followUpCronWorker = new Worker<FollowUpCronJobData>(
    'followup-cron',
    processFollowUpCronJob,
    { connection, concurrency: 1 },
  );
  followUpCronWorker.on('completed', (job) => {
    logger.debug({ jobId: job.id, jobName: job.name }, 'Follow-up cron job completed');
  });
  followUpCronWorker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, jobName: job?.name, err }, 'Follow-up cron job failed');
  });

  logger.info('BullMQ workers started (email, report, payment-reconciliation, payment-cron, external-api-cron, followup-cron)');
}

export async function stopWorkers(): Promise<void> {
  const workers = [
    emailWorker,
    reportWorker,
    paymentReconciliationWorker,
    paymentCronWorker,
    externalApiCronWorker,
    followUpCronWorker,
  ].filter(Boolean) as Worker[];

  await Promise.allSettled(workers.map((w) => w.close()));
  logger.info('BullMQ workers stopped');
}
