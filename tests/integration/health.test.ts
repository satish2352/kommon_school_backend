process.env['NODE_ENV'] = 'test';
process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/test_db';
process.env['JWT_ACCESS_SECRET'] = 'test_access_secret_that_is_at_least_32_chars_long';
process.env['JWT_REFRESH_SECRET'] = 'test_refresh_secret_that_is_at_least_32_chars_long';
process.env['LOG_LEVEL'] = 'silent';
process.env['LOG_PRETTY'] = 'false';
process.env['SWAGGER_ENABLED'] = 'false';

import request from 'supertest';
import { createApp } from '../../src/app';

describe('Health endpoints', () => {
  const app = createApp();

  describe('GET /api/v1/health', () => {
    it('returns 200 with status ok', async () => {
      const res = await request(app).get('/api/v1/health').expect(200);

      expect(res.body).toMatchObject({
        status: 'ok',
        timestamp: expect.any(String),
        uptime: expect.any(Number),
      });
    });
  });

  describe('GET /api/v1/health/ready', () => {
    it('returns 200 or 503 (either is acceptable in test env)', async () => {
      const res = await request(app).get('/api/v1/health/ready');
      expect([200, 503]).toContain(res.status);
      expect(res.body).toHaveProperty('status');
      expect(res.body).toHaveProperty('checks');
      expect(res.body.checks).toHaveProperty('database');
      expect(res.body.checks).toHaveProperty('redis');
    });
  });

  describe('GET /api/v1/health/metrics', () => {
    it('returns 200 with memory and process info', async () => {
      const res = await request(app).get('/api/v1/health/metrics').expect(200);

      expect(res.body).toHaveProperty('memory');
      expect(res.body).toHaveProperty('uptime');
      expect(res.body.memory).toHaveProperty('heapUsed');
    });
  });

  describe('GET /unknown-route', () => {
    it('returns 404 for unregistered routes', async () => {
      const res = await request(app).get('/api/v1/nonexistent').expect(404);

      expect(res.body).toMatchObject({
        success: false,
        error: {
          code: 'NOT_FOUND',
        },
      });
    });
  });

  describe('X-Request-Id header', () => {
    it('injects a request ID into the response', async () => {
      const res = await request(app).get('/api/v1/health');
      expect(res.headers['x-request-id']).toBeDefined();
    });

    it('echoes back a provided X-Request-Id', async () => {
      const customId = 'test-req-12345';
      const res = await request(app)
        .get('/api/v1/health')
        .set('X-Request-Id', customId);
      expect(res.headers['x-request-id']).toBe(customId);
    });
  });
});
