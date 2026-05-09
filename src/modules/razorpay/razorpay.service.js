'use strict';

const Razorpay = require('razorpay');
const { getPrismaClient } = require('../../config/database');
const { decrypt, hmacSha256, timingSafeEqual } = require('../../utils/crypto');
const ApiError = require('../../utils/ApiError');
const logger = require('../../config/logger');

/**
 * Load the currently active Razorpay configuration from the DB and decrypt
 * the key_secret. Returns { razorpayInstance, config } where config includes
 * the decrypted key_secret and webhook_secret for signature verification.
 *
 * Edge case #15: payment row stores razorpay_config_id so verification always
 * uses the key set that was active when the order was created, even if the
 * active config changes mid-flight.
 */
async function getActiveConfig() {
  const db = getPrismaClient();
  const config = await db.razorpayConfiguration.findFirst({
    where: { is_active: true },
  });

  if (!config) {
    throw ApiError.internal('No active Razorpay configuration found');
  }

  const keySecret = decrypt(config.key_secret_encrypted);
  const webhookSecret = decrypt(config.webhook_secret_encrypted);

  const instance = new Razorpay({
    key_id: config.key_id,
    key_secret: keySecret,
  });

  return { instance, config, keySecret, webhookSecret };
}

/**
 * Load a specific Razorpay config by its ID (used in verify to match the
 * config that was active at order creation time).
 */
async function getConfigById(configId) {
  const db = getPrismaClient();
  const config = await db.razorpayConfiguration.findUnique({
    where: { id: configId },
  });
  if (!config) throw ApiError.internal('Razorpay configuration not found');
  const keySecret = decrypt(config.key_secret_encrypted);
  const webhookSecret = decrypt(config.webhook_secret_encrypted);
  return { config, keySecret, webhookSecret };
}

/**
 * Create a Razorpay order. Amount must be in paise (integer).
 *
 * @param {Razorpay} instance
 * @param {object} opts
 * @returns {Promise<object>} Razorpay order object
 */
async function createOrder(instance, { amount, currency, receipt, notes }) {
  const orderOptions = {
    amount,
    currency: currency || 'INR',
    receipt,
    notes: notes || {},
  };

  try {
    const order = await instance.orders.create(orderOptions);
    return order;
  } catch (err) {
    logger.error({ msg: 'razorpay_create_order_failed', error: err.message, receipt });
    throw ApiError.internal('Failed to create Razorpay order');
  }
}

/**
 * Verify the payment signature for the frontend verify flow.
 * HMAC-SHA256(order_id|payment_id, key_secret) === signature
 * Uses timing-safe comparison to prevent timing attacks.
 */
function verifyPaymentSignature(orderId, paymentId, signature, keySecret) {
  const message = `${orderId}|${paymentId}`;
  const expected = hmacSha256(message, keySecret);
  return timingSafeEqual(expected, signature);
}

/**
 * Verify a webhook event signature.
 * HMAC-SHA256(rawBody, webhookSecret) === x-razorpay-signature header
 */
function verifyWebhookSignature(rawBody, signature, webhookSecret) {
  const expected = hmacSha256(rawBody, webhookSecret);
  return timingSafeEqual(expected, signature);
}

/**
 * Fetch all payments for a Razorpay order and return the latest captured
 * payment entity, or null if none exists.
 *
 * Used by the payment-reconciliation cron to check whether a payment that
 * is still `pending` or `initiated` in our DB was actually captured remotely.
 *
 * @param {string} orderId  — Razorpay order_id (e.g. "order_XXXXXXXXXX")
 * @returns {Promise<object|null>}
 */
async function fetchRazorpayPayment(orderId) {
  try {
    const { instance } = await getActiveConfig();
    const result = await instance.orders.fetchPayments(orderId);
    // result.items is an array; find the most recent captured payment
    const items = (result && result.items) ? result.items : [];
    const captured = items.find((p) => p.status === 'captured');
    return captured || null;
  } catch (err) {
    logger.error({
      msg: 'razorpay_fetch_payment_failed',
      order_id: orderId,
      error: err.message,
    });
    return null;
  }
}

module.exports = {
  getActiveConfig,
  getConfigById,
  createOrder,
  verifyPaymentSignature,
  verifyWebhookSignature,
  fetchRazorpayPayment,
};
