import { Request, Response } from 'express';
import { asyncHandler } from '@/utils/asyncHandler';
import { ApiResponse } from '@/utils/ApiResponse';
import { authService } from './auth.service';
import type { RegisterInput, LoginInput, RefreshTokenInput, ChangePasswordInput } from './auth.schema';

/**
 * @openapi
 * /auth/register:
 *   post:
 *     tags: [Auth]
 *     summary: Register a new user
 *     description: Creates a new user account within the tenant context. Provide X-Tenant-Id header to register within a school.
 *     security: []
 *     parameters:
 *       - in: header
 *         name: X-Tenant-Id
 *         schema:
 *           type: string
 *         description: Tenant slug or ID (required for non-super-admin roles)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password, firstName, lastName]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *                 minLength: 8
 *               firstName:
 *                 type: string
 *               lastName:
 *                 type: string
 *               role:
 *                 type: string
 *                 enum: [SCHOOL_ADMIN, TEACHER, STUDENT, PARENT]
 *                 default: STUDENT
 *     responses:
 *       201:
 *         description: User registered successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         user:
 *                           type: object
 *                         tokens:
 *                           type: object
 *       409:
 *         description: Email already exists
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 *       422:
 *         $ref: '#/components/responses/ValidationError'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
export const register = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const input = req.body as RegisterInput;
  const tenantId = req.tenant?.id ?? null;

  const result = await authService.register(
    input,
    tenantId,
    req.headers['user-agent'],
    req.ip,
  );

  ApiResponse.created(res, result, 'Registration successful');
});

/**
 * @openapi
 * /auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Login
 *     description: Authenticate with email and password. Returns access + refresh tokens.
 *     security: []
 *     parameters:
 *       - in: header
 *         name: X-Tenant-Id
 *         schema:
 *           type: string
 *         description: Tenant slug or ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Login successful
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
export const login = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const input = req.body as LoginInput;
  const tenantId = req.tenant?.id ?? null;

  const result = await authService.login(
    input,
    tenantId,
    req.headers['user-agent'],
    req.ip,
  );

  ApiResponse.success(res, result, 'Login successful');
});

/**
 * @openapi
 * /auth/refresh:
 *   post:
 *     tags: [Auth]
 *     summary: Refresh access token
 *     description: Exchange a valid refresh token for a new access + refresh token pair.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [refreshToken]
 *             properties:
 *               refreshToken:
 *                 type: string
 *     responses:
 *       200:
 *         description: Tokens refreshed
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
export const refreshToken = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const input = req.body as RefreshTokenInput;

  const tokens = await authService.refreshTokens(
    input,
    req.headers['user-agent'],
    req.ip,
  );

  ApiResponse.success(res, tokens, 'Tokens refreshed');
});

/**
 * @openapi
 * /auth/logout:
 *   post:
 *     tags: [Auth]
 *     summary: Logout
 *     description: Revoke the current or all refresh tokens for the authenticated user.
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               refreshToken:
 *                 type: string
 *                 description: If provided, only this token is revoked. Otherwise all sessions are revoked.
 *     responses:
 *       200:
 *         description: Logout successful
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
export const logout = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.id;
  const refreshToken = (req.body as { refreshToken?: string }).refreshToken;

  await authService.logout(userId, refreshToken);

  ApiResponse.success(res, null, 'Logged out successfully');
});

/**
 * @openapi
 * /auth/change-password:
 *   post:
 *     tags: [Auth]
 *     summary: Change password
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [currentPassword, newPassword]
 *             properties:
 *               currentPassword:
 *                 type: string
 *               newPassword:
 *                 type: string
 *                 minLength: 8
 *     responses:
 *       200:
 *         description: Password changed — all sessions revoked
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
export const changePassword = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.id;
  const input = req.body as ChangePasswordInput;

  await authService.changePassword(userId, input);

  ApiResponse.success(res, null, 'Password changed successfully. Please log in again');
});

/**
 * @openapi
 * /auth/me:
 *   get:
 *     tags: [Auth]
 *     summary: Get current user
 *     description: Returns the authenticated user's profile.
 *     responses:
 *       200:
 *         description: Current user
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
export const getMe = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  ApiResponse.success(res, req.user, 'Current user');
});
