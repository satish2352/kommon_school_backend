'use strict';

const repo = require('./user.repository');
const authRepo = require('../../auth/auth.repository');
const auditService = require('../../audit/audit.service');
const { hashPassword } = require('../../../utils/crypto');
const ApiError = require('../../../utils/ApiError');
const logger = require('../../../config/logger');
const { parsePagination, buildMeta } = require('../../../utils/pagination');
const { ERROR_CODES } = require('../../../config/constants');

const ALLOWED_SORT_FIELDS = ['created_at', 'email', 'role'];

/**
 * Create a new user. Hashes password with bcrypt cost 12.
 * Throws 409 on duplicate email.
 *
 * @param {{ email: string, password: string, role: string, actor: object, req: object }} opts
 * @returns {Promise<object>} sanitized user (no password_hash)
 */
async function createUser({ email, password, role, actor, req }) {
  const existing = await repo.findUserByEmail(email);
  if (existing) {
    throw ApiError.conflict('A user with that email already exists');
  }

  const password_hash = await hashPassword(password);
  const user = await repo.createUser({ email, password_hash, role });

  logger.info({ msg: 'admin_user_created', user_id: user.id, email: user.email, role: user.role });

  await auditService.record({
    actor,
    action: 'user.create',
    entityType: 'user',
    entityId: user.id,
    changes: { email, role },
    req,
  });

  return user;
}

/**
 * Paginated list of users. Supports search by email, filter by role, filter by
 * status (active = deleted_at IS NULL; deleted = deleted_at IS NOT NULL).
 *
 * @param {object} query
 * @param {string} traceId
 * @returns {Promise<{ rows: object[], meta: object }>}
 */
async function listUsers(query, traceId) {
  const { page, limit, skip, sortOrder, dateFrom, dateTo } = parsePagination(query);
  const sortBy = ALLOWED_SORT_FIELDS.includes(query.sortBy) ? query.sortBy : 'created_at';

  const where = {};

  if (query.search) {
    where.email = { contains: query.search.trim(), mode: 'insensitive' };
  }

  if (query.role) {
    where.role = query.role;
  }

  if (query.status === 'active') {
    where.deleted_at = null;
  } else if (query.status === 'deleted') {
    where.deleted_at = { not: null };
  }

  if (dateFrom || dateTo) {
    where.created_at = {};
    if (dateFrom) where.created_at.gte = dateFrom;
    if (dateTo) where.created_at.lte = dateTo;
  }

  const { rows, total } = await repo.listUsers({
    skip,
    take: limit,
    where,
    orderBy: { [sortBy]: sortOrder },
  });

  logger.info({ msg: 'admin_users_listed', traceId, total, page, limit });

  return { rows, meta: buildMeta(page, limit, total) };
}

/**
 * Return a single user by ID (sanitized). 404 if not found.
 *
 * @param {string} id
 * @returns {Promise<object>}
 */
async function getUserById(id) {
  const user = await repo.findUserById(id);
  if (!user) {
    throw ApiError.notFound('User not found');
  }
  return user;
}

/**
 * Update a user's role and/or password. Cannot update yourself.
 *
 * @param {{ id: string, patch: object, actor: object, req: object }} opts
 * @returns {Promise<object>} sanitized updated user
 */
async function updateUser({ id, patch, actor, req }) {
  if (actor && actor.id === id) {
    throw new ApiError(409, ERROR_CODES.CANNOT_MODIFY_SELF, 'Cannot modify your own account via this endpoint');
  }

  const existing = await repo.findUserById(id);
  if (!existing) {
    throw ApiError.notFound('User not found');
  }

  const data = {};
  const auditChanges = {};

  if (patch.role !== undefined) {
    data.role = patch.role;
    auditChanges.role = patch.role;
  }

  if (patch.password !== undefined) {
    data.password_hash = await hashPassword(patch.password);
    auditChanges.password_changed = true;
  }

  const updated = await repo.updateUser(id, data);

  logger.info({ msg: 'admin_user_updated', user_id: id, changes: auditChanges });

  await auditService.record({
    actor,
    action: 'user.update',
    entityType: 'user',
    entityId: id,
    changes: auditChanges,
    req,
  });

  return updated;
}

/**
 * Soft-delete a user. Cannot delete yourself. Also revokes all refresh tokens.
 *
 * @param {{ id: string, actor: object, req: object }} opts
 * @returns {Promise<object>} sanitized deleted user
 */
async function deleteUser({ id, actor, req }) {
  if (actor && actor.id === id) {
    throw new ApiError(409, ERROR_CODES.CANNOT_MODIFY_SELF, 'Cannot delete your own account');
  }

  const existing = await repo.findUserById(id);
  if (!existing) {
    throw ApiError.notFound('User not found');
  }

  await authRepo.revokeAllTokensForUser(id);
  const deleted = await repo.softDeleteUser(id);

  logger.info({ msg: 'admin_user_deleted', user_id: id });

  await auditService.record({
    actor,
    action: 'user.delete',
    entityType: 'user',
    entityId: id,
    changes: null,
    req,
  });

  return deleted;
}

/**
 * Reactivate a previously soft-deleted user (clears deleted_at).
 *
 * Symmetric counterpart to deleteUser — added so admins can toggle
 * employee accounts on/off without losing the row's identity (id, email,
 * audit trail, assigned leads). Idempotent: reactivating an already-active
 * user is a no-op success, not an error, so the UI can call it freely
 * from a "Activate" button without first reading the state.
 *
 * @param {{ id: string, actor: object, req: object }} opts
 * @returns {Promise<object>} sanitized reactivated user
 */
async function reactivateUser({ id, actor, req }) {
  const existing = await repo.findUserById(id);
  if (!existing) {
    throw ApiError.notFound('User not found');
  }
  // Already active? Return without changes — keeps the endpoint idempotent
  // and avoids an extra audit row for a no-op click.
  if (existing.deleted_at == null) {
    return existing;
  }

  const reactivated = await repo.updateUser(id, { deleted_at: null });

  logger.info({ msg: 'admin_user_reactivated', user_id: id });

  await auditService.record({
    actor,
    action:     'user.reactivate',
    entityType: 'user',
    entityId:   id,
    changes:    null,
    req,
  });

  return reactivated;
}

module.exports = {
  createUser,
  listUsers,
  getUserById,
  updateUser,
  deleteUser,
  reactivateUser,
};
