// Cron job registration via BullMQ repeatable jobs.
//
// Uses BullMQ Queue.add({ repeat: { pattern } }) -- no node-cron dependency.
// Each job is deduped by jobId so multiple server instances don't double-register.
//
// Cron schedule summary:
//   payment-recovery          every 5 min    (pattern: "*/5 * * * *")
//   payment-reconciliation    every 30 min   (pattern: "*/30 * * * *")
//   payment-expiry            every 10 min   (pattern: "*/10 * * * *")
//   external-api-retry        every 15 min   (pattern: "*/15 * * * *")
//   dlq-processor             hourly         (pattern: "0 * * * *")
//   follow-up-reminder        every 10 min   (pattern: "*/10 * * * *")
//   stale-leads               every 6 hours  (pattern: "0 */6 * * *")
//   auto-close                daily midnight (pattern: "0 0 * * *")

import { env } from '@/config/env';
import { logger } from '@/config/logger';
import { paymentCronQueue, externalApiCronQueue, followUpCronQueue } from './queues';

export async function registerCronJobs(): Promise<void> {
  if (!env.CRON_ENABLED) {
    logger.info('CRON_ENABLED=false — cron jobs skipped');
    return;
  }

  logger.info('Registering cron jobs via BullMQ repeatable jobs...');

  // ── Payment cron jobs ───────────────────────────────────────────────────────

  await paymentCronQueue.add(
    'payment-recovery',
    { correlationId: 'cron:payment-recovery' },
    {
      jobId: 'payment-recovery-cron',
      repeat: { pattern: '*/5 * * * *' },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 500 },
    },
  );

  await paymentCronQueue.add(
    'payment-reconciliation',
    { correlationId: 'cron:payment-reconciliation' },
    {
      jobId: 'payment-reconciliation-cron',
      repeat: { pattern: '*/30 * * * *' },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 500 },
    },
  );

  await paymentCronQueue.add(
    'payment-expiry',
    { correlationId: 'cron:payment-expiry' },
    {
      jobId: 'payment-expiry-cron',
      repeat: { pattern: '*/10 * * * *' },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 500 },
    },
  );

  // ── External API cron jobs ──────────────────────────────────────────────────

  await externalApiCronQueue.add(
    'external-api-retry',
    { correlationId: 'cron:external-api-retry' },
    {
      jobId: 'external-api-retry-cron',
      repeat: { pattern: '*/15 * * * *' },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 500 },
    },
  );

  await externalApiCronQueue.add(
    'dlq-processor',
    { correlationId: 'cron:dlq-processor' },
    {
      jobId: 'dlq-processor-cron',
      repeat: { pattern: '0 * * * *' },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 500 },
    },
  );

  // ── Follow-up cron jobs ─────────────────────────────────────────────────────

  await followUpCronQueue.add(
    'follow-up-reminder',
    { correlationId: 'cron:follow-up-reminder' },
    {
      jobId: 'follow-up-reminder-cron',
      repeat: { pattern: '*/10 * * * *' },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 500 },
    },
  );

  await followUpCronQueue.add(
    'stale-leads',
    { correlationId: 'cron:stale-leads' },
    {
      jobId: 'stale-leads-cron',
      repeat: { pattern: '0 */6 * * *' },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 500 },
    },
  );

  await followUpCronQueue.add(
    'auto-close',
    { correlationId: 'cron:auto-close' },
    {
      jobId: 'auto-close-cron',
      repeat: { pattern: '0 0 * * *' },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 500 },
    },
  );

  logger.info('Cron jobs registered successfully');
}
