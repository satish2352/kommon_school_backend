import { UserRole } from '@prisma/client';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '@/config/database';
import { hashPassword, comparePassword } from '@/utils/password';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '@/utils/jwt';
import { ApiError } from '@/utils/ApiError';
import { cacheDelete, buildCacheKey } from '@/utils/cache';
import { logger } from '@/config/logger';
import type { RegisterInput, LoginInput, RefreshTokenInput, ChangePasswordInput } from './auth.schema';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
}

export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  tenantId: string | null;
  isEmailVerified: boolean;
}

export class AuthService {
  /**
   * Register a new user within the current tenant.
   */
  async register(
    input: RegisterInput,
    tenantId: string | null,
    userAgent?: string,
    ipAddress?: string,
  ): Promise<{ user: AuthUser; tokens: AuthTokens }> {
    // Check if email already exists in this tenant
    const existingUser = await prisma.user.findFirst({
      where: {
        email: input.email,
        tenantId: tenantId ?? null,
        deletedAt: null,
      },
    });

    if (existingUser) {
      throw ApiError.conflict('An account with this email already exists');
    }

    const passwordHash = await hashPassword(input.password);

    const user = await prisma.user.create({
      data: {
        email: input.email,
        passwordHash,
        firstName: input.firstName,
        lastName: input.lastName,
        role: (input.role as UserRole) ?? UserRole.STUDENT,
        tenantId: tenantId ?? null,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        tenantId: true,
        isEmailVerified: true,
      },
    });

    const tokens = await this.issueTokens(user, userAgent, ipAddress);

    logger.info({ userId: user.id, tenantId, email: user.email }, 'User registered');

    return { user, tokens };
  }

  /**
   * Login with email + password.
   */
  async login(
    input: LoginInput,
    tenantId: string | null,
    userAgent?: string,
    ipAddress?: string,
  ): Promise<{ user: AuthUser; tokens: AuthTokens }> {
    const user = await prisma.user.findFirst({
      where: {
        email: input.email,
        tenantId: tenantId ?? null,
        deletedAt: null,
      },
    });

    // Constant-time check — always compare even if user doesn't exist (prevents timing attacks)
    const dummyHash = '$2b$12$invalidhashforintentionalconstanttimecheck00000000000000';
    const passwordValid = user
      ? await comparePassword(input.password, user.passwordHash)
      : await comparePassword(input.password, dummyHash);

    if (!user || !passwordValid) {
      throw ApiError.unauthorized('Invalid email or password');
    }

    if (!user.isActive) {
      throw ApiError.forbidden('Account is deactivated');
    }

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    // Invalidate cached user
    await cacheDelete(buildCacheKey('user', user.id));

    const tokens = await this.issueTokens(user, userAgent, ipAddress);

    logger.info({ userId: user.id, tenantId, email: user.email }, 'User logged in');

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        tenantId: user.tenantId,
        isEmailVerified: user.isEmailVerified,
      },
      tokens,
    };
  }

  /**
   * Rotate refresh token (token family rotation — detects reuse attacks).
   */
  async refreshTokens(
    input: RefreshTokenInput,
    userAgent?: string,
    ipAddress?: string,
  ): Promise<AuthTokens> {
    const payload = verifyRefreshToken(input.refreshToken);

    const tokenHash = this.hashToken(input.refreshToken);

    const storedToken = await prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: { select: { id: true, email: true, role: true, tenantId: true, isActive: true, deletedAt: true } } },
    });

    if (!storedToken) {
      // Token not in DB — may be reuse attack; revoke entire family
      await this.revokeTokenFamily(payload.family);
      throw ApiError.unauthorized('Invalid refresh token');
    }

    if (storedToken.isRevoked) {
      // Reuse detected — revoke entire family
      await this.revokeTokenFamily(storedToken.family);
      logger.warn({ userId: storedToken.userId, family: storedToken.family }, 'Refresh token reuse detected');
      throw ApiError.unauthorized('Refresh token reuse detected. Please log in again');
    }

    if (storedToken.expiresAt < new Date()) {
      throw ApiError.unauthorized('Refresh token expired');
    }

    const user = storedToken.user;
    if (!user.isActive || user.deletedAt) {
      throw ApiError.unauthorized('User account is inactive');
    }

    // Revoke old token
    await prisma.refreshToken.update({
      where: { id: storedToken.id },
      data: { isRevoked: true },
    });

    // Issue new tokens in the same family
    const tokens = await this.issueTokens(
      { id: user.id, email: user.email, role: user.role, tenantId: user.tenantId },
      userAgent,
      ipAddress,
      storedToken.family,
    );

    return tokens;
  }

  /**
   * Revoke all refresh tokens for the current user (logout).
   */
  async logout(userId: string, refreshToken?: string): Promise<void> {
    if (refreshToken) {
      const tokenHash = this.hashToken(refreshToken);
      await prisma.refreshToken.updateMany({
        where: { tokenHash, userId },
        data: { isRevoked: true },
      });
    } else {
      // Revoke all tokens for the user
      await prisma.refreshToken.updateMany({
        where: { userId, isRevoked: false },
        data: { isRevoked: true },
      });
    }

    await cacheDelete(buildCacheKey('user', userId));
    logger.info({ userId }, 'User logged out');
  }

  /**
   * Change password.
   */
  async changePassword(userId: string, input: ChangePasswordInput): Promise<void> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, passwordHash: true },
    });

    if (!user) {
      throw ApiError.notFound('User');
    }

    const currentPasswordValid = await comparePassword(input.currentPassword, user.passwordHash);
    if (!currentPasswordValid) {
      throw ApiError.unauthorized('Current password is incorrect');
    }

    const newPasswordHash = await hashPassword(input.newPassword);

    await prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: newPasswordHash,
        passwordChangedAt: new Date(),
      },
    });

    // Revoke all refresh tokens (force re-login everywhere)
    await prisma.refreshToken.updateMany({
      where: { userId, isRevoked: false },
      data: { isRevoked: true },
    });

    await cacheDelete(buildCacheKey('user', userId));
    logger.info({ userId }, 'Password changed — all sessions revoked');
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async issueTokens(
    user: { id: string; email: string; role: UserRole; tenantId: string | null },
    userAgent?: string,
    ipAddress?: string,
    existingFamily?: string,
  ): Promise<AuthTokens> {
    const family = existingFamily ?? uuidv4();

    const accessToken = signAccessToken({
      sub: user.id,
      tenantId: user.tenantId,
      role: user.role,
      email: user.email,
    });

    const refreshToken = signRefreshToken({
      sub: user.id,
      tenantId: user.tenantId,
      family,
    });

    const tokenHash = this.hashToken(refreshToken);

    // Parse refresh token expiry from env
    const expiryMs = this.parseExpiry(process.env['JWT_REFRESH_EXPIRY'] ?? '7d');
    const expiresAt = new Date(Date.now() + expiryMs);

    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tenantId: user.tenantId,
        tokenHash,
        family,
        expiresAt,
        userAgent: userAgent ?? null,
        ipAddress: ipAddress ?? null,
      },
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: process.env['JWT_ACCESS_EXPIRY'] ?? '15m',
    };
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  private async revokeTokenFamily(family: string): Promise<void> {
    await prisma.refreshToken.updateMany({
      where: { family, isRevoked: false },
      data: { isRevoked: true },
    });
  }

  private parseExpiry(expiry: string): number {
    const unit = expiry.slice(-1);
    const value = parseInt(expiry.slice(0, -1), 10);
    const multipliers: Record<string, number> = {
      s: 1000,
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
    };
    return value * (multipliers[unit] ?? 1000);
  }
}

export const authService = new AuthService();
