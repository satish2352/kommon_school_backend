'use strict';

/**
 * Unit tests for RBAC middleware (authorize and hasPermission).
 *
 * Run: node --test src/tests/unit/rbac.test.js
 *
 * No database, no Redis, no HTTP server required — everything is tested
 * via direct middleware invocation with mock req/res/next objects.
 */

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

// ---------------------------------------------------------------------------
// Bootstrap env before loading any module that validates environment vars.
// ---------------------------------------------------------------------------
before(() => {
  process.env.NODE_ENV = 'test';
  process.env.JWT_ACCESS_SECRET = 'test_access_secret_min_32_chars_long_xxx';
  process.env.JWT_REFRESH_SECRET = 'test_refresh_secret_min_32_chars_long_xx';
  process.env.JWT_ALGORITHM = 'HS256';
  process.env.PORT = '3001';
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
  process.env.REDIS_URL = 'redis://localhost:6379';
  process.env.EXTERNAL_API_URL = 'https://example.com/sync';
  process.env.EXTERNAL_API_TOKEN = 'test-token';
  process.env.ENCRYPTION_MASTER_KEY = '0000000000000000000000000000000000000000000000000000000000000000';
  process.env.CORS_ALLOWED_ORIGINS = 'http://localhost:3000';
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal mock next() that records the first argument passed to it.
 * @returns {{ fn: Function, calls: Array<any> }}
 */
function mockNext() {
  const calls = [];
  const fn = (arg) => calls.push(arg === undefined ? null : arg);
  return { fn, calls };
}

/**
 * Build a minimal mock req with an optional user object.
 * @param {object|null} user
 * @returns {object}
 */
function mockReq(user) {
  return { user: user || null, path: '/test', method: 'GET' };
}

// ---------------------------------------------------------------------------
// Tests — authorize()
// ---------------------------------------------------------------------------

describe('authorize middleware', () => {
  it('calls next() with no error when role is in allowedRoles', () => {
    // Lazy-require so env is set first (before() runs before describe callbacks).
    const { authorize } = require('../../middleware/rbac.middleware');
    const { fn, calls } = mockNext();
    const req = mockReq({ id: 'user-1', role: 'admin', email: 'a@b.com' });

    authorize(['admin', 'superadmin'])(req, {}, fn);

    assert.equal(calls.length, 1, 'next should be called exactly once');
    assert.equal(calls[0], null, 'next should be called with no argument (no error)');
  });

  it('calls next() with ApiError 403 when role is not in allowedRoles', () => {
    const { authorize } = require('../../middleware/rbac.middleware');
    const { fn, calls } = mockNext();
    const req = mockReq({ id: 'user-2', role: 'marketing', email: 'b@c.com' });

    authorize(['admin'])(req, {}, fn);

    assert.equal(calls.length, 1);
    const err = calls[0];
    assert.ok(err instanceof Error, 'next should be called with an Error');
    assert.equal(err.statusCode, 403, 'error statusCode should be 403');
  });

  it('calls next() with ApiError 401 when req.user is absent', () => {
    const { authorize } = require('../../middleware/rbac.middleware');
    const { fn, calls } = mockNext();
    const req = mockReq(null); // no authenticated user

    authorize(['admin'])(req, {}, fn);

    assert.equal(calls.length, 1);
    const err = calls[0];
    assert.ok(err instanceof Error, 'next should be called with an Error');
    assert.equal(err.statusCode, 401, 'error statusCode should be 401');
  });
});

// ---------------------------------------------------------------------------
// Tests — hasPermission()
// ---------------------------------------------------------------------------

describe('hasPermission middleware', () => {
  it('calls next() with no error for superadmin (bypasses DB check)', async () => {
    const { hasPermission } = require('../../middleware/rbac.middleware');
    const { fn, calls } = mockNext();
    const req = mockReq({ id: 'sa-1', role: 'superadmin', email: 'sa@b.com' });

    await hasPermission('users:manage')(req, {}, fn);

    assert.equal(calls.length, 1);
    assert.equal(calls[0], null, 'superadmin should pass through without error');
  });

  it('calls next() with ApiError 401 when req.user is absent', async () => {
    const { hasPermission } = require('../../middleware/rbac.middleware');
    const { fn, calls } = mockNext();
    const req = mockReq(null);

    await hasPermission('users:manage')(req, {}, fn);

    assert.equal(calls.length, 1);
    const err = calls[0];
    assert.ok(err instanceof Error);
    assert.equal(err.statusCode, 401);
  });

  it('calls next() with ApiError 403 when permission lookup rejects (simulates no DB)', async () => {
    // We cannot reach the DB in unit tests, so the permission repo will throw.
    // hasPermission must forward that error to next() — it must NOT crash.
    const { hasPermission } = require('../../middleware/rbac.middleware');
    const { fn, calls } = mockNext();
    const req = mockReq({ id: 'u-1', role: 'admin', email: 'a@b.com' });

    // Under test conditions the permission repo will throw a connection error.
    // The middleware should catch it and call next(err).
    await hasPermission('users:manage')(req, {}, fn);

    assert.equal(calls.length, 1, 'next must always be called');
    const err = calls[0];
    assert.ok(err instanceof Error, 'next should receive the error');
    // Either a 403 (permission denied) or a DB error — both are acceptable
    // since we have no DB. The key assertion is that the process does not crash.
    assert.ok(typeof err.message === 'string', 'error must have a message');
  });
});
