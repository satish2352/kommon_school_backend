'use strict';

const { v4: uuidv4 } = require('uuid');
const logger = require('../config/logger');

/**
 * Attaches a unique traceId to each request and logs method, url, status,
 * and latency on response finish. The traceId is forwarded to all downstream
 * logs via req.traceId so structured log entries can be correlated.
 */
function requestLogger(req, res, next) {
  req.traceId = uuidv4();
  res.setHeader('X-Trace-Id', req.traceId);

  const startAt = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startAt) / 1e6;
    logger.info({
      msg: 'http_request',
      traceId: req.traceId,
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      duration_ms: Math.round(durationMs),
      user_id: req.user ? req.user.id : undefined,
    });
  });

  next();
}

module.exports = requestLogger;
