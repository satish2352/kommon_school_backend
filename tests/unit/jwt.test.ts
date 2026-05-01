// Set test env vars before importing modules
process.env['NODE_ENV'] = 'test';
process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/test';
process.env['JWT_ACCESS_SECRET'] = 'test_access_secret_that_is_at_least_32_chars_long';
process.env['JWT_REFRESH_SECRET'] = 'test_refresh_secret_that_is_at_least_32_chars_long';
process.env['JWT_ACCESS_EXPIRY'] = '15m';
process.env['JWT_REFRESH_EXPIRY'] = '7d';

import { signAccessToken, verifyAccessToken, signRefreshToken, verifyRefreshToken } from '../../src/utils/jwt';
import { ApiError } from '../../src/utils/ApiError';

describe('JWT utilities', () => {
  const mockPayload = {
    sub: 'user-id-123',
    tenantId: 'tenant-id-456',
    role: 'SCHOOL_ADMIN',
    email: 'test@example.com',
  };

  describe('access tokens', () => {
    it('signs and verifies an access token', () => {
      const token = signAccessToken(mockPayload);
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3);

      const decoded = verifyAccessToken(token);
      expect(decoded.sub).toBe(mockPayload.sub);
      expect(decoded.email).toBe(mockPayload.email);
      expect(decoded.role).toBe(mockPayload.role);
      expect(decoded.tenantId).toBe(mockPayload.tenantId);
    });

    it('throws UNAUTHORIZED for tampered tokens', () => {
      const token = signAccessToken(mockPayload);
      const tampered = token.slice(0, -5) + 'XXXXX';

      expect(() => verifyAccessToken(tampered)).toThrow(ApiError);
      expect(() => verifyAccessToken(tampered)).toThrow(
        expect.objectContaining({ code: 'UNAUTHORIZED' }),
      );
    });

    it('throws UNAUTHORIZED for expired tokens', () => {
      const { sign } = require('jsonwebtoken');
      const expiredToken = sign(
        { ...mockPayload, exp: Math.floor(Date.now() / 1000) - 1 },
        process.env['JWT_ACCESS_SECRET'],
      );

      expect(() => verifyAccessToken(expiredToken)).toThrow(
        expect.objectContaining({ message: 'Access token expired' }),
      );
    });
  });

  describe('refresh tokens', () => {
    it('signs and verifies a refresh token', () => {
      const payload = { sub: 'user-id-123', tenantId: 'tenant-id-456', family: 'family-uuid' };
      const token = signRefreshToken(payload);

      const decoded = verifyRefreshToken(token);
      expect(decoded.sub).toBe(payload.sub);
      expect(decoded.family).toBe(payload.family);
    });
  });
});
