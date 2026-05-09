'use strict';

const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Key material cache — loaded once per process lifetime to avoid repeated
// disk reads. Keys are never written to logs or error messages.
// ---------------------------------------------------------------------------
let _accessPrivateKey = null;
let _accessPublicKey = null;
let _refreshPrivateKey = null;
let _refreshPublicKey = null;

/**
 * Read a PEM file from disk, caching the result in the closure variable.
 * Throws a clear error if the file is missing or unreadable.
 *
 * @param {string} filePath - absolute or CWD-relative path to the PEM file
 * @param {string} label - human-readable label for error messages
 * @returns {Buffer}
 */
function loadKeyFile(filePath, label) {
  const resolved = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(process.cwd(), filePath);
  try {
    return fs.readFileSync(resolved);
  } catch (err) {
    throw new Error(
      `JWT RS256: cannot read ${label} at '${resolved}': ${err.message}. ` +
        'Set JWT_ACCESS_PRIVATE_KEY_PATH, JWT_ACCESS_PUBLIC_KEY_PATH, ' +
        'JWT_REFRESH_PRIVATE_KEY_PATH, JWT_REFRESH_PUBLIC_KEY_PATH in your env.',
    );
  }
}

/**
 * Lazily initialise RS256 key material. Subsequent calls return the same
 * cached Buffers.
 */
function ensureRs256Keys() {
  const env = process.env;

  if (!_accessPrivateKey) {
    _accessPrivateKey = loadKeyFile(env.JWT_ACCESS_PRIVATE_KEY_PATH, 'JWT_ACCESS_PRIVATE_KEY');
  }
  if (!_accessPublicKey) {
    _accessPublicKey = loadKeyFile(env.JWT_ACCESS_PUBLIC_KEY_PATH, 'JWT_ACCESS_PUBLIC_KEY');
  }
  if (!_refreshPrivateKey) {
    _refreshPrivateKey = loadKeyFile(env.JWT_REFRESH_PRIVATE_KEY_PATH, 'JWT_REFRESH_PRIVATE_KEY');
  }
  if (!_refreshPublicKey) {
    _refreshPublicKey = loadKeyFile(env.JWT_REFRESH_PUBLIC_KEY_PATH, 'JWT_REFRESH_PUBLIC_KEY');
  }
}

/**
 * Determine whether the process is configured for RS256 or HS256.
 *
 * @returns {boolean}
 */
function isRs256() {
  return (process.env.JWT_ALGORITHM || 'HS256') === 'RS256';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Sign an access token.
 *
 * @param {object} payload - claims to embed (sub, email, role, ...)
 * @returns {string} signed JWT
 */
function signAccess(payload) {
  if (isRs256()) {
    ensureRs256Keys();
    return jwt.sign(payload, _accessPrivateKey, {
      algorithm: 'RS256',
      expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
    });
  }
  return jwt.sign(payload, process.env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
  });
}

/**
 * Sign a refresh token.
 *
 * @param {object} payload - claims to embed (sub, fam, jti, ...)
 * @returns {string} signed JWT
 */
function signRefresh(payload) {
  if (isRs256()) {
    ensureRs256Keys();
    return jwt.sign(payload, _refreshPrivateKey, {
      algorithm: 'RS256',
      expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
    });
  }
  return jwt.sign(payload, process.env.JWT_REFRESH_SECRET, {
    algorithm: 'HS256',
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  });
}

/**
 * Verify an access token and return the decoded payload.
 * Throws a jsonwebtoken error on invalid or expired tokens.
 *
 * @param {string} token
 * @returns {object} decoded payload
 */
function verifyAccess(token) {
  if (isRs256()) {
    ensureRs256Keys();
    return jwt.verify(token, _accessPublicKey, { algorithms: ['RS256'] });
  }
  return jwt.verify(token, process.env.JWT_ACCESS_SECRET, { algorithms: ['HS256'] });
}

/**
 * Verify a refresh token and return the decoded payload.
 * Throws a jsonwebtoken error on invalid or expired tokens.
 *
 * @param {string} token
 * @returns {object} decoded payload
 */
function verifyRefresh(token) {
  if (isRs256()) {
    ensureRs256Keys();
    return jwt.verify(token, _refreshPublicKey, { algorithms: ['RS256'] });
  }
  return jwt.verify(token, process.env.JWT_REFRESH_SECRET, { algorithms: ['HS256'] });
}

module.exports = { signAccess, signRefresh, verifyAccess, verifyRefresh };
