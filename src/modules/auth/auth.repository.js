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
  findUserWithHashById,
  updatePassword,
  createRefreshToken,
  findRefreshToken,
  findRefreshTokensByFamily,
  revokeRefreshToken,
  revokeAllTokensForUser,
  revokeFamilyTokens,
};
