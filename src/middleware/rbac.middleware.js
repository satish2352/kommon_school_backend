'use strict';

const ApiError = require('../utils/ApiError');
const permissionRepo = require('../modules/permissions/permission.repository');
const logger = require('../config/logger');

// ---------------------------------------------------------------------------
// In-process permission cache (role -> { codes, expiresAt })
// TTL is intentionally short (60 s) so permission changes propagate quickly
// without requiring a process restart. In a multi-instance deployment, each
// instance maintains its own cache; changes land within one TTL window.
// ---------------------------------------------------------------------------
const CACHE_TTL_MS = 60_000;

/** @type {Map<string, { codes: string[], expiresAt: number }>} */
const roleCache = new Map();

/**
 * Fetch permission codes for a role, consulting the in-process cache first.
 * Cache miss triggers a DB lookup; result is stored with a 60-second TTL.
 *
 * @param {string} role
 * @returns {Promise<string[]>}
 */
async function getPermissionsForRole(role) {
  const now = Date.now();
  const cached = roleCache.get(role);
  if (cached && cached.expiresAt > now) {
    return cached.codes;
  }

  const codes = await permissionRepo.findPermissionsByRole(role);
  roleCache.set(role, { codes, expiresAt: now + CACHE_TTL_MS });

  logger.debug({ msg: 'permission_cache_refreshed', role, count: codes.length });
  return codes;
}

/**
 * Evict all cached permission sets.
 * Call after seeding or any runtime permission change so the next request
 * fetches a fresh set from the database.
 */
function clearPermissionCache() {
  roleCache.clear();
  logger.info({ msg: 'permission_cache_cleared' });
}

// ---------------------------------------------------------------------------
// authorize — coarse role-based guard (preserved for backward compatibility)
// ---------------------------------------------------------------------------

/**
 * Role-based access control middleware factory.
 * Usage: router.get('/route', authenticate, authorize(['admin', 'superadmin']), handler)
 *
 * @param {string[]} allowedRoles - roles that may access the route
 * @returns {Function} Express middleware
 */
function authorize(allowedRoles) {
  return (req, _res, next) => {
    if (!req.user) {
      return next(ApiError.unauthorized('Authentication required'));
    }
    if (!allowedRoles.includes(req.user.role)) {
      return next(ApiError.forbidden('Insufficient permissions'));
    }
    next();
  };
}

// ---------------------------------------------------------------------------
// hasPermission — granular permission-code guard
// ---------------------------------------------------------------------------

/**
 * Middleware factory that checks whether the authenticated user's role holds
 * a specific permission code.
 *
 * Superadmin always bypasses the check (they hold all permissions by design).
 * Other roles are checked against the role_permissions table via a short-lived
 * in-process cache (TTL = 60 s).
 *
 * Usage:
 *   router.get('/route', authenticate, hasPermission(PERMISSIONS.ENROLLMENTS_VIEW), handler)
 *
 * @param {string} code - permission code string (e.g. 'enrollments:view')
 * @returns {Function} async Express middleware
 */
function hasPermission(code) {
  return async (req, _res, next) => {
    if (!req.user) {
      return next(ApiError.unauthorized('Authentication required'));
    }

    // Superadmin has unrestricted access — skip DB lookup entirely.
    if (req.user.role === 'superadmin') {
      return next();
    }

    try {
      const codes = await getPermissionsForRole(req.user.role);
      if (!codes.includes(code)) {
        logger.warn({
          msg: 'permission_denied',
          user_id: req.user.id,
          role: req.user.role,
          required_permission: code,
          path: req.path,
          method: req.method,
        });
        return next(ApiError.forbidden('Insufficient permissions'));
      }
      next();
    } catch (err) {
      logger.error({
        msg: 'permission_check_error',
        user_id: req.user.id,
        role: req.user.role,
        required_permission: code,
        error: err.message,
      });
      next(err);
    }
  };
}

module.exports = { authorize, hasPermission, clearPermissionCache };
