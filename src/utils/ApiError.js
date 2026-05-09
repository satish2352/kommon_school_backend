'use strict';

const { HTTP, ERROR_CODES } = require('../config/constants');

class ApiError extends Error {
  /**
   * @param {number} statusCode
   * @param {string} code       - machine-readable error code from ERROR_CODES
   * @param {string} message    - human-readable message
   * @param {Array}  [details]  - validation detail array
   */
  constructor(statusCode, code, message, details) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details || null;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message, details) {
    return new ApiError(HTTP.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR, message, details);
  }

  static unauthorized(message = 'Unauthorized') {
    return new ApiError(HTTP.UNAUTHORIZED, ERROR_CODES.UNAUTHORIZED, message);
  }

  static forbidden(message = 'Forbidden') {
    return new ApiError(HTTP.FORBIDDEN, ERROR_CODES.FORBIDDEN, message);
  }

  static notFound(message = 'Resource not found') {
    return new ApiError(HTTP.NOT_FOUND, ERROR_CODES.NOT_FOUND, message);
  }

  static conflict(message, code) {
    return new ApiError(HTTP.CONFLICT, code || ERROR_CODES.CONFLICT, message);
  }

  static internal(message = 'Internal server error') {
    return new ApiError(HTTP.INTERNAL, ERROR_CODES.INTERNAL_ERROR, message);
  }
}

module.exports = ApiError;
