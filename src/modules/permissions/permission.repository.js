'use strict';

const { getPrismaClient } = require('../../config/database');

function getDb() {
  return getPrismaClient();
}

/**
 * Return all permission codes assigned to a given role.
 * Used by the hasPermission middleware for cache-miss lookups.
 *
 * @param {string} role - Role enum value (superadmin | admin | marketing)
 * @returns {Promise<string[]>} - array of permission code strings
 */
async function findPermissionsByRole(role) {
  const rows = await getDb().rolePermission.findMany({
    where: { role },
    select: {
      permission: {
        select: { code: true },
      },
    },
  });
  return rows.map((r) => r.permission.code);
}

/**
 * Return all permission rows (id + code + description).
 * Used by admin tooling and the seed script.
 *
 * @returns {Promise<object[]>}
 */
async function findAllPermissions() {
  return getDb().permission.findMany({
    orderBy: { code: 'asc' },
    select: { id: true, code: true, description: true, created_at: true },
  });
}

/**
 * Upsert a permission by code. Creates if absent, updates description if present.
 *
 * @param {{ code: string, description?: string }} opts
 * @returns {Promise<object>} the permission row
 */
async function upsertPermission({ code, description }) {
  return getDb().permission.upsert({
    where: { code },
    create: { code, description: description || null },
    update: { description: description || null },
  });
}

/**
 * Bulk-assign a list of permission IDs to a role.
 * Silently skips rows that already exist (skipDuplicates).
 *
 * @param {string} role - Role enum value
 * @param {string[]} permissionIds - array of permission UUIDs
 * @returns {Promise<{ count: number }>}
 */
async function assignPermissionsToRole(role, permissionIds) {
  if (!permissionIds || permissionIds.length === 0) {
    return { count: 0 };
  }
  return getDb().rolePermission.createMany({
    data: permissionIds.map((permission_id) => ({ role, permission_id })),
    skipDuplicates: true,
  });
}

/**
 * Remove all permission assignments for a role.
 * Used before re-seeding to keep the seed idempotent.
 *
 * @param {string} role - Role enum value
 * @returns {Promise<{ count: number }>}
 */
async function clearRolePermissions(role) {
  return getDb().rolePermission.deleteMany({ where: { role } });
}

module.exports = {
  findPermissionsByRole,
  findAllPermissions,
  upsertPermission,
  assignPermissionsToRole,
  clearRolePermissions,
};
