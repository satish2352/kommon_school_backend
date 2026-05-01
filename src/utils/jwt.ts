import jwt, { SignOptions, JwtPayload } from 'jsonwebtoken';
import { env } from '@/config/env';
import { ApiError } from './ApiError';

export interface AccessTokenPayload {
  sub: string;       // userId
  tenantId: string | null;
  role: string;
  email: string;
  iat?: number;
  exp?: number;
}

export interface RefreshTokenPayload {
  sub: string;       // userId
  tenantId: string | null;
  family: string;    // token family for rotation tracking
  iat?: number;
  exp?: number;
}

export function signAccessToken(payload: Omit<AccessTokenPayload, 'iat' | 'exp'>): string {
  const options: SignOptions = {
    expiresIn: env.JWT_ACCESS_EXPIRY as string,
    algorithm: 'HS256',
  };
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, options);
}

export function signRefreshToken(payload: Omit<RefreshTokenPayload, 'iat' | 'exp'>): string {
  const options: SignOptions = {
    expiresIn: env.JWT_REFRESH_EXPIRY as string,
    algorithm: 'HS256',
  };
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, options);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET) as JwtPayload & AccessTokenPayload;
    return decoded;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw ApiError.unauthorized('Access token expired');
    }
    if (err instanceof jwt.JsonWebTokenError) {
      throw ApiError.unauthorized('Invalid access token');
    }
    throw ApiError.unauthorized('Token verification failed');
  }
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  try {
    const decoded = jwt.verify(token, env.JWT_REFRESH_SECRET) as JwtPayload & RefreshTokenPayload;
    return decoded;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw ApiError.unauthorized('Refresh token expired');
    }
    if (err instanceof jwt.JsonWebTokenError) {
      throw ApiError.unauthorized('Invalid refresh token');
    }
    throw ApiError.unauthorized('Token verification failed');
  }
}

export function decodeToken(token: string): JwtPayload | null {
  try {
    return jwt.decode(token) as JwtPayload;
  } catch {
    return null;
  }
}
