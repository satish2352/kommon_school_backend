'use strict';

/**
 * Preserves the raw request body for Razorpay webhook signature verification.
 * Must be used BEFORE express.json() on the webhook route.
 *
 * Razorpay HMAC is computed over the raw byte string of the body.
 * If json() middleware parses first, the raw buffer is lost.
 *
 * Usage: router.post('/razorpay', webhookRaw, webhookController.handle)
 */
function webhookRaw(req, res, next) {
  let data = '';
  req.on('data', (chunk) => {
    data += chunk;
  });
  req.on('end', () => {
    req.rawBody = data;
    try {
      req.body = JSON.parse(data);
    } catch {
      req.body = {};
    }
    next();
  });
  req.on('error', next);
}

module.exports = webhookRaw;
