'use strict';

/**
 * Unit tests for external.retry.handler.js classify() function.
 *
 * Run: node --test src/tests/unit/retryHandler.test.js
 *
 * Pure in-process tests — no network, no DB, no Redis.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { classify } = require('../../modules/externalApi/external.retry.handler');

// ---------------------------------------------------------------------------
// Helper: build a minimal axios-shaped error with a response status code
// ---------------------------------------------------------------------------
function axiosErr(status, headers) {
  const err = new Error(`Request failed with status code ${status}`);
  err.response = {
    status,
    headers: headers || {},
  };
  return err;
}

// Helper: build a network error (no response)
function networkErr(code) {
  const err = new Error('connect ECONNREFUSED 127.0.0.1:9999');
  err.code = code || 'ECONNREFUSED';
  // no err.response property
  return err;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('classify() — terminal client errors', () => {
  it('400 → terminal: true, retry: false', () => {
    const result = classify(axiosErr(400));
    assert.equal(result.terminal, true, 'should be terminal');
    assert.equal(result.retry, false, 'should not retry');
  });

  it('422 → terminal: true, retry: false', () => {
    const result = classify(axiosErr(422));
    assert.equal(result.terminal, true);
    assert.equal(result.retry, false);
  });
});

describe('classify() — retryable auth error', () => {
  it('401 → retry: true, terminal: false, reason: UNAUTHORIZED', () => {
    const result = classify(axiosErr(401));
    assert.equal(result.retry, true);
    assert.equal(result.terminal, false);
    assert.equal(result.reason, 'UNAUTHORIZED');
  });
});

describe('classify() — already synced (treat as success)', () => {
  it('409 → terminal: false, retry: false, reason: ALREADY_SYNCED', () => {
    const result = classify(axiosErr(409));
    assert.equal(result.terminal, false);
    assert.equal(result.retry, false);
    assert.equal(result.reason, 'ALREADY_SYNCED');
  });
});

describe('classify() — rate limited', () => {
  it('429 → retry: true, reason: RATE_LIMITED', () => {
    const result = classify(axiosErr(429));
    assert.equal(result.retry, true);
    assert.equal(result.reason, 'RATE_LIMITED');
  });

  it('429 with numeric retry-after header → retryAfterMs parsed correctly', () => {
    const err = axiosErr(429, { 'retry-after': '5' });
    const result = classify(err);
    assert.equal(result.retry, true);
    assert.equal(result.reason, 'RATE_LIMITED');
    assert.equal(result.retryAfterMs, 5000, 'retryAfterMs should be 5000 ms');
  });
});

describe('classify() — transient server errors', () => {
  it('500 → retry: true, reason: TRANSIENT', () => {
    const result = classify(axiosErr(500));
    assert.equal(result.retry, true);
    assert.equal(result.terminal, false);
    assert.equal(result.reason, 'TRANSIENT');
  });

  it('503 → retry: true, reason: TRANSIENT', () => {
    const result = classify(axiosErr(503));
    assert.equal(result.retry, true);
    assert.equal(result.reason, 'TRANSIENT');
  });
});

describe('classify() — network errors (no response)', () => {
  it('ECONNREFUSED → retry: true, reason: TRANSIENT', () => {
    const result = classify(networkErr('ECONNREFUSED'));
    assert.equal(result.retry, true);
    assert.equal(result.terminal, false);
    assert.equal(result.reason, 'TRANSIENT');
  });

  it('ETIMEDOUT → retry: true, reason: TRANSIENT', () => {
    const result = classify(networkErr('ETIMEDOUT'));
    assert.equal(result.retry, true);
    assert.equal(result.reason, 'TRANSIENT');
  });
});
