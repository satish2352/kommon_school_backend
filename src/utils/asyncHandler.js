'use strict';

/**
 * Wraps an async route handler so that any thrown error is forwarded to
 * Express next() instead of being an unhandled rejection.
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = asyncHandler;
