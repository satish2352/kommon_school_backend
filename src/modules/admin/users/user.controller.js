'use strict';

const userService = require('./user.service');
const { sendSuccess } = require('../../../utils/ApiResponse');
const asyncHandler = require('../../../utils/asyncHandler');
const { HTTP } = require('../../../config/constants');

/**
 * POST /api/v1/admin/users
 */
const create = asyncHandler(async (req, res) => {
  const user = await userService.createUser({
    email: req.body.email,
    password: req.body.password,
    role: req.body.role,
    actor: req.user,
    req,
  });
  sendSuccess(res, HTTP.CREATED, user, 'User created');
});

/**
 * GET /api/v1/admin/users
 */
const list = asyncHandler(async (req, res) => {
  const { rows, meta } = await userService.listUsers(req.query, req.traceId);
  sendSuccess(res, HTTP.OK, rows, undefined, meta);
});

/**
 * GET /api/v1/admin/users/:id
 */
const getById = asyncHandler(async (req, res) => {
  const user = await userService.getUserById(req.params.id);
  sendSuccess(res, HTTP.OK, user);
});

/**
 * PATCH /api/v1/admin/users/:id
 */
const update = asyncHandler(async (req, res) => {
  const user = await userService.updateUser({
    id: req.params.id,
    patch: req.body,
    actor: req.user,
    req,
  });
  sendSuccess(res, HTTP.OK, user, 'User updated');
});

/**
 * DELETE /api/v1/admin/users/:id
 */
const remove = asyncHandler(async (req, res) => {
  const user = await userService.deleteUser({
    id: req.params.id,
    actor: req.user,
    req,
  });
  sendSuccess(res, HTTP.OK, user, 'User deleted');
});

/**
 * POST /api/v1/admin/users/:id/reactivate
 *
 * Clears deleted_at on a previously soft-deleted user. Idempotent.
 * Symmetric to the DELETE soft-delete so the Employees page can
 * surface an Activate / Deactivate toggle without a separate code path.
 */
const reactivate = asyncHandler(async (req, res) => {
  const user = await userService.reactivateUser({
    id:    req.params.id,
    actor: req.user,
    req,
  });
  sendSuccess(res, HTTP.OK, user, 'User reactivated');
});

module.exports = { create, list, getById, update, remove, reactivate };
