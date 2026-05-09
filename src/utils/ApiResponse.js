'use strict';

/**
 * Send a standardised success envelope.
 * Shape: { success: true, data, meta?, message? }
 */
function sendSuccess(res, statusCode, data, message, meta) {
  const body = { success: true, data };
  if (message !== undefined) body.message = message;
  if (meta !== undefined) body.meta = meta;
  return res.status(statusCode).json(body);
}

/**
 * Send a standardised error envelope.
 * Shape: { success: false, error: { code, message, details? }, traceId }
 */
function sendError(res, statusCode, code, message, traceId, details) {
  const error = { code, message };
  if (details) error.details = details;
  return res.status(statusCode).json({ success: false, error, traceId: traceId || null });
}

module.exports = { sendSuccess, sendError };
