'use strict';

const authService = require('./auth.service');
const auditService = require('../audit/audit.service');
const { sendSuccess } = require('../../utils/ApiResponse');
const asyncHandler = require('../../utils/asyncHandler');
const { HTTP } = require('../../config/constants');

const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const result = await authService.login(email, password, req.traceId, req);
  sendSuccess(res, HTTP.OK, result, 'Login successful');
});

const refresh = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  const result = await authService.refresh(refreshToken, req.traceId);
  sendSuccess(res, HTTP.OK, result, 'Token refreshed');
});

const logout = asyncHandler(async (req, res) => {
  await authService.logout(req.user.id, req.traceId, req);
  sendSuccess(res, HTTP.OK, null, 'Logged out successfully');
});

const me = asyncHandler(async (req, res) => {
  const user = await authService.getMe(req.user.id);
  sendSuccess(res, HTTP.OK, user);
});

/**
 * POST /api/v1/auth/change-password
 *
 * Requires a valid access token (authenticate middleware).
 * Body: { currentPassword, newPassword }
 *
 * On success, all existing refresh tokens for the user are revoked so every
 * other session is forced to re-authenticate immediately.
 */
const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const result = await authService.changePassword(
    req.user.id,
    currentPassword,
    newPassword,
    req.traceId,
  );

  // Emit audit event after successful password change.
  // auditService.record never throws, so this will not break the response.
  await auditService.record({
    actor:      req.user,
    action:     'auth.change_password',
    entityType: 'user',
    entityId:   req.user.id,
    changes:    {},
    req,
  });

  sendSuccess(res, HTTP.OK, result, 'Password changed successfully');
});

module.exports = { login, refresh, logout, me, changePassword };
