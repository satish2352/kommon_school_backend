'use strict';

const { verifyAccess } = require('../config/jwt');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');

/**
 * Verifies the Bearer access token in the Authorization header.
 * On success, attaches decoded payload to req.user.
 * On failure, throws 401 ApiError.
 */
const authenticate = asyncHandler(async (req, _res, next) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw ApiError.unauthorized('Missing or malformed Authorization header');
  }

  const token = authHeader.slice(7);

  let decoded;
  try {
    decoded = verifyAccess(token);
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw ApiError.unauthorized('Access token expired');
    }
    throw ApiError.unauthorized('Invalid access token');
  }

  req.user = {
    id: decoded.sub,
    email: decoded.email,
    role: decoded.role,
  };

  next();
});

module.exports = { authenticate };
