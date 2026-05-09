'use strict';

/**
 * Unit tests for ApiResponse envelope helpers (sendSuccess / sendError).
 *
 * Run: node --test src/tests/unit/envelope.test.js
 *
 * Pure in-process tests — no HTTP server, no framework.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { sendSuccess, sendError } = require('../../utils/ApiResponse');

// ---------------------------------------------------------------------------
// Mock response object
// Captures the call chain: res.status(code).json(body) → { statusCode, body }
// ---------------------------------------------------------------------------
function mockRes() {
  const captured = { statusCode: null, body: null };

  const res = {
    status(code) {
      captured.statusCode = code;
      return {
        json(b) {
          captured.body = b;
          return captured;
        },
      };
    },
    _captured: captured,
  };

  return res;
}

// ---------------------------------------------------------------------------
// sendSuccess tests
// ---------------------------------------------------------------------------

describe('sendSuccess()', () => {
  it('wraps data in { success: true, data } envelope with correct status', () => {
    const res = mockRes();
    sendSuccess(res, 200, { foo: 1 });

    assert.equal(res._captured.statusCode, 200);
    assert.deepEqual(res._captured.body, {
      success: true,
      data: { foo: 1 },
    });
  });

  it('includes message when provided', () => {
    const res = mockRes();
    sendSuccess(res, 201, { id: 'abc' }, 'Created successfully');

    assert.equal(res._captured.statusCode, 201);
    assert.equal(res._captured.body.success, true);
    assert.equal(res._captured.body.message, 'Created successfully');
    assert.deepEqual(res._captured.body.data, { id: 'abc' });
  });

  it('includes meta when provided', () => {
    const res = mockRes();
    const meta = { page: 1, limit: 20, total: 100, totalPages: 5 };
    sendSuccess(res, 200, [], undefined, meta);

    assert.deepEqual(res._captured.body.meta, meta);
    assert.ok(!('message' in res._captured.body), 'message should be absent when not passed');
  });

  it('omits message and meta keys when both are undefined', () => {
    const res = mockRes();
    sendSuccess(res, 200, null);

    const keys = Object.keys(res._captured.body);
    assert.ok(!keys.includes('message'), 'message key should not be present');
    assert.ok(!keys.includes('meta'), 'meta key should not be present');
  });
});

// ---------------------------------------------------------------------------
// sendError tests
// ---------------------------------------------------------------------------

describe('sendError()', () => {
  it('wraps error in { success: false, error: { code, message }, traceId } envelope', () => {
    const res = mockRes();
    sendError(res, 400, 'VALIDATION_ERROR', 'email is required', 'trace-001');

    assert.equal(res._captured.statusCode, 400);
    assert.deepEqual(res._captured.body, {
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'email is required' },
      traceId: 'trace-001',
    });
  });

  it('sets traceId to null when not provided', () => {
    const res = mockRes();
    sendError(res, 500, 'INTERNAL_ERROR', 'Unexpected error');

    assert.equal(res._captured.body.traceId, null);
  });

  it('includes details when provided', () => {
    const res = mockRes();
    const details = [{ field: 'email', message: 'must be a valid email' }];
    sendError(res, 422, 'UNPROCESSABLE', 'Validation failed', 'tid-x', details);

    assert.deepEqual(res._captured.body.error.details, details);
    assert.equal(res._captured.body.error.code, 'UNPROCESSABLE');
    assert.equal(res._captured.body.traceId, 'tid-x');
  });

  it('omits details key when details is not provided', () => {
    const res = mockRes();
    sendError(res, 404, 'NOT_FOUND', 'Resource missing', 'tid-y');

    assert.ok(!('details' in res._captured.body.error), 'details should be absent');
  });
});
