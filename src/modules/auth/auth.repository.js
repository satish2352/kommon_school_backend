'use strict';

const { getPrismaClient } = require('../../config/database');

function getDb() {
  return getPrismaClient();
}

async function findUserByEmail(email) {
  return getDb().user.findFirst({
    where: { email, deleted_at: null },
    select: {
      id: true,
      email: true,
      password_hash: true,
      role: true,
    },
  });
}

async function findUserById(id) {
  return getDb().user.findFirst({
    where: { id, deleted_at: null },
    select: {
      id: true,
      email: true,
      role: true,
      created_at: true,
    },
  });
}

/**
 * Find a user by ID and return the password_hash so the change-password
 * service can verify the current credential before updating.
 *
 * @param {string} id - user UUID
 * @returns {Promise<{ id: string, email: string, password_hash: string } | null>}
 */
/**
 * Find the Sumago mirror row for a user by email. This is where a provisioned
 * end-user's profile fields and `planHistory` (their transaction history) live —
 * the auth `users` table and `sumago_users` table are linked by email only.
 *
 * Email is stored lowercased in sumago_users (see sumagoUserSync.mapToRow), so
 * we lowercase the lookup key to match.
 *
 * @param {string} email
 * @returns {Promise<object|null>}
 */
async function findSumagoUserByEmail(email) {
  return getDb().sumagoUser.findFirst({
    where: { email: String(email || '').trim().toLowerCase() },
    select: {
      firstName: true,
      lastName: true,
      phoneNumber: true,
      plan: true,
      groupName: true,
      unit: true,
      phase: true,
      segment: true,
      emailStatus: true,
      onboardingStatus: true,
      planHistory: true,
    },
  });
}

/**
 * Find all (non-deleted) enrollments for an email, with their payments and plan
 * relations, so the panel can build transaction rows from LOCAL records rather
 * than depending solely on the Sumago-synced planHistory. Case-insensitive
 * match (emails are stored lowercased on new rows).
 *
 * @param {string} email
 * @returns {Promise<object[]>}
 */
async function findEnrollmentsWithPaymentsByEmail(email) {
  return getDb().enrollment.findMany({
    where: { email: { equals: String(email || '').trim(), mode: 'insensitive' }, deleted_at: null },
    include: {
      payments:      true,
      plan_pricing:  { include: { plan: true } },
      internal_plan: { select: { name: true } },
    },
    orderBy: { created_at: 'desc' },
  });
}

async function findUserWithHashById(id) {
  return getDb().user.findFirst({
    where: { id, deleted_at: null },
    select: {
      id: true,
      email: true,
      password_hash: true,
    },
  });
}

/**
 * Update the password_hash for a user.
 *
 * @param {string} userId
 * @param {string} passwordHash - bcrypt hash of the new password
 * @returns {Promise<object>}
 */
async function updatePassword(userId, passwordHash) {
  return getDb().user.update({
    where: { id: userId },
    data: { password_hash: passwordHash },
  });
}

async function createRefreshToken(data) {
  return getDb().refreshToken.create({ data });
}

async function findRefreshToken(tokenHash) {
  return getDb().refreshToken.findFirst({
    where: { token_hash: tokenHash },
  });
}

async function findRefreshTokensByFamily(familyId) {
  return getDb().refreshToken.findMany({
    where: { family_id: familyId },
  });
}

async function revokeRefreshToken(id) {
  return getDb().refreshToken.update({
    where: { id },
    data: { revoked_at: new Date() },
  });
}

async function revokeAllTokensForUser(userId) {
  return getDb().refreshToken.updateMany({
    where: { user_id: userId, revoked_at: null },
    data: { revoked_at: new Date() },
  });
}

async function revokeFamilyTokens(familyId) {
  return getDb().refreshToken.updateMany({
    where: { family_id: familyId, revoked_at: null },
    data: { revoked_at: new Date() },
  });
}

module.exports = {
  findUserByEmail,
  findUserById,
  findSumagoUserByEmail,
  findEnrollmentsWithPaymentsByEmail,
  findUserWithHashById,
  updatePassword,
  createRefreshToken,
  findRefreshToken,
  findRefreshTokensByFamily,
  revokeRefreshToken,
  revokeAllTokensForUser,
  revokeFamilyTokens,
};
