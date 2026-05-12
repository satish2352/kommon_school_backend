'use strict';

const { Prisma } = require('@prisma/client');
const logger = require('../config/logger');
const { sendError } = require('../utils/ApiResponse');
const ApiError = require('../utils/ApiError');
const { ERROR_CODES, HTTP } = require('../config/constants');

/**
 * Centralised error handler. Must be registered as the LAST middleware in app.js.
 * Converts ApiError, Prisma errors, and unexpected errors into the standard
 * error envelope: { success: false, error: { code, message, details? }, traceId }.
 */
function errorHandler(err, req, res, _next) {
  const traceId = req.traceId || null;

  // Operational errors raised intentionally by the application
  if (err instanceof ApiError) {
    logger.warn({
      msg: 'operational_error',
      traceId,
      code: err.code,
      status: err.statusCode,
      message: err.message,
    });
    return sendError(res, err.statusCode, err.code, err.message, traceId, err.details);
  }

  // Prisma — connectivity / engine errors (return 503 with a clearer hint than
  // the generic 500. These typically mean the DB is down or the connection
  // dropped mid-query.)
  if (err instanceof Prisma.PrismaClientInitializationError) {
    logger.error({ msg: 'prisma_init_error', traceId, code: err.errorCode, error: err.message });
    return sendError(
      res,
      HTTP.SERVICE_UNAVAILABLE ?? 503,
      ERROR_CODES.SERVICE_UNAVAILABLE ?? 'SERVICE_UNAVAILABLE',
      'Database is currently unreachable. Please try again in a moment.',
      traceId,
    );
  }

  // Prisma unique / not-found / connectivity errors (known request errors).
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      const field = err.meta?.target?.join(', ') || 'field';
      logger.warn({ msg: 'prisma_unique_violation', traceId, field });
      return sendError(res, HTTP.CONFLICT, ERROR_CODES.CONFLICT, `Duplicate value for ${field}`, traceId);
    }
    if (err.code === 'P2025') {
      logger.warn({ msg: 'prisma_not_found', traceId });
      return sendError(res, HTTP.NOT_FOUND, ERROR_CODES.NOT_FOUND, 'Record not found', traceId);
    }
    // P1001: Can't reach database server, P1002: timed out, P1008: timeout,
    // P1017: server closed connection, P2024: pool timeout
    if (['P1001', 'P1002', 'P1008', 'P1017', 'P2024'].includes(err.code)) {
      logger.error({ msg: 'prisma_connectivity_error', traceId, code: err.code, error: err.message });
      return sendError(
        res,
        HTTP.SERVICE_UNAVAILABLE ?? 503,
        ERROR_CODES.SERVICE_UNAVAILABLE ?? 'SERVICE_UNAVAILABLE',
        `Database connectivity error (${err.code}). The server may be restarting — please retry.`,
        traceId,
      );
    }
  }

  // Prisma — connection thrown without code (rare; surfaces as PrismaClientRustPanicError or similar)
  if (err instanceof Prisma.PrismaClientRustPanicError || err instanceof Prisma.PrismaClientUnknownRequestError) {
    logger.error({ msg: 'prisma_engine_error', traceId, error: err.message });
    return sendError(
      res,
      HTTP.SERVICE_UNAVAILABLE ?? 503,
      ERROR_CODES.SERVICE_UNAVAILABLE ?? 'SERVICE_UNAVAILABLE',
      'Database engine error. Please retry.',
      traceId,
    );
  }

  // Prisma validation errors (bad data shape reaching the ORM)
  if (err instanceof Prisma.PrismaClientValidationError) {
    logger.error({ msg: 'prisma_validation_error', traceId, stack: err.message });
    return sendError(res, HTTP.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR, 'Invalid data', traceId);
  }

  // JWT library errors that escaped auth middleware
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    return sendError(res, HTTP.UNAUTHORIZED, ERROR_CODES.UNAUTHORIZED, err.message, traceId);
  }

  // Unknown / programming errors — log stack, return generic 500
  logger.error({
    msg: 'unhandled_error',
    traceId,
    error: err.message,
    stack: err.stack,
  });

  return sendError(res, HTTP.INTERNAL, ERROR_CODES.INTERNAL_ERROR, 'An unexpected error occurred', traceId);
}

module.exports = errorHandler;
