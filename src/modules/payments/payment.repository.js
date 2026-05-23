'use strict';

const { getPrismaClient } = require('../../config/database');

function getDb() {
  return getPrismaClient();
}

async function createPayment(data) {
  return getDb().payment.create({ data });
}

async function findPaymentById(id) {
  return getDb().payment.findUnique({
    where: { id },
  });
}

async function findPaymentByOrderId(razorpayOrderId) {
  return getDb().payment.findUnique({
    where: { razorpay_order_id: razorpayOrderId },
  });
}

async function findPaymentsByEnrollmentId(enrollmentId) {
  return getDb().payment.findMany({
    where: { enrollment_id: enrollmentId },
    orderBy: { created_at: 'desc' },
  });
}

/**
 * Update a payment row and the associated enrollment inside a single Prisma
 * transaction. Uses $queryRaw SELECT FOR UPDATE on the payment row to prevent
 * the race condition between the verify endpoint and the webhook path.
 *
 * Edge case #5 (verify vs webhook race): both paths attempt to update the same
 * payment row. SELECT FOR UPDATE on the payment ensures that whichever arrives
 * first acquires the row lock; the second path reads the already-updated status
 * and returns without double-processing.
 *
 * Edge case #13 (network failure mid-transaction): the entire $transaction block
 * is atomic — if any step fails, Postgres rolls back and no partial state leaks.
 */
async function settlePayment({ paymentId, razorpayPaymentId, razorpaySignature, enrollmentId, expectedAmount, actualAmount }) {
  const db = getPrismaClient();

  return db.$transaction(
    async (tx) => {
      // Lock the payment row to prevent concurrent verify+webhook from both succeeding
      const rows = await tx.$queryRaw`
        SELECT id, status, amount FROM payments WHERE id = ${paymentId}::uuid FOR UPDATE
      `;

      if (!rows || rows.length === 0) {
        throw new Error('Payment not found in transaction');
      }

      const payment = rows[0];

      // Idempotency: if already settled, return current state without re-processing
      if (payment.status === 'success') {
        return { alreadySettled: true };
      }

      // Edge case #12: reject if actual amount charged does not match expected amount
      if (Number(payment.amount) !== Number(actualAmount)) {
        await tx.payment.update({
          where: { id: paymentId },
          data: { status: 'failed', razorpay_payment_id: razorpayPaymentId },
        });
        throw new Error(`AMOUNT_MISMATCH:${payment.amount}:${actualAmount}`);
      }

      // Settle the payment
      await tx.payment.update({
        where: { id: paymentId },
        data: {
          status: 'success',
          razorpay_payment_id: razorpayPaymentId,
          razorpay_signature: razorpaySignature || null,
        },
      });

      // Update enrollment:
      //  * status='paid'                    — terminal payment lifecycle state.
      //  * amount_paid_paise=actualAmount   — so the admin UI can show "₹X
      //    received" without joining to payments[]. Public-flow rows were
      //    leaving this at 0 because only the admin-internal path was
      //    writing it (bug surfaced by the SumagoUsers page).
      //  * external_sync_status='PENDING'   — we're about to enqueue the
      //    Sumago webhook job; the worker will flip this to SUCCESS or
      //    DEAD_LETTER. Separate from `status` so a sync failure no
      //    longer pollutes the customer-facing payment state.
      await tx.enrollment.update({
        where: { id: enrollmentId },
        data: {
          status:               'paid',
          amount_paid_paise:    Number(actualAmount),
          external_sync_status: 'PENDING',
        },
      });

      return { alreadySettled: false };
    },
    {
      // Edge case #13: bound transaction lifetime to prevent long-running locks.
      // Bumped from 10s to 15s — remote dev DB (13.48.254.211) adds round-trip latency.
      timeout: 15000,
      // Serializable isolation for financial writes
      isolationLevel: 'Serializable',
    },
  );
}

async function updatePaymentStatus(paymentId, status, extra) {
  return getPrismaClient().payment.update({
    where: { id: paymentId },
    data: { status, ...extra },
  });
}

module.exports = {
  createPayment,
  findPaymentById,
  findPaymentByOrderId,
  findPaymentsByEnrollmentId,
  settlePayment,
  updatePaymentStatus,
};
