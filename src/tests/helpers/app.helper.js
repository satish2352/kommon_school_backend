'use strict';

/**
 * Integration test helpers.
 *
 * These helpers are designed for pure-Node tests (node:test + assert/strict).
 * They do NOT start a real HTTP server or connect to a real database — they
 * only provide the Express app instance and a JWT factory for unit / light
 * integration tests.
 *
 * Usage:
 *   const { buildTestApp, signTestAccessToken } = require('./app.helper');
 *   const app = buildTestApp();
 *   const token = signTestAccessToken({ id: 'uuid', email: 'a@b.com', role: 'admin' });
 */

/**
 * Build and return the Express application instance.
 * The app module initialises env validation on require, so the caller must
 * have the required env vars set (at minimum JWT_ACCESS_SECRET) before calling
 * this function.
 *
 * @returns {import('express').Express}
 */
function buildTestApp() {
  // Clear require cache so each test suite gets a fresh instance if needed.
  // In practice most test files share the same process, so the cached module
  // is re-used — which is the desired behaviour for performance.
  return require('../../app');
}

/**
 * Mint a short-lived HS256 access token for use in test Authorization headers.
 * The caller must ensure JWT_ACCESS_SECRET is set in process.env before
 * calling this (done at the top of each test file).
 *
 * @param {{ id: string, email: string, role: string }} claims
 * @returns {string} Signed JWT access token
 */
function signTestAccessToken({ id, email, role }) {
  const { signAccess } = require('../../config/jwt');
  return signAccess({ sub: id, email, role });
}

module.exports = { buildTestApp, signTestAccessToken };
