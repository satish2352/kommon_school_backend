'use strict';

const { v4: uuidv4 } = require('uuid');
const repo = require('./auth.repository');
const { comparePassword, hashPassword, sha256 } = require('../../utils/crypto');
const { signAccess, signRefresh, verifyRefresh } = require('../../config/jwt');
const ApiError = require('../../utils/ApiError');
const logger = require('../../config/logger');
const auditService = require('../audit/audit.service');
const { ERROR_CODES } = require('../../config/constants');

function refreshExpiresAt() {
  const ms = 7 * 24 * 60 * 60 * 1000; // 7 days
  return new Date(Date.now() + ms);
}

function buildAccessPayload(user) {
  return { sub: user.id, email: user.email, role: user.role };
}

function buildRefreshPayload(userId, familyId, tokenId) {
  return { sub: userId, fam: familyId, jti: tokenId };
}

async function login(email, password, traceId, req) {
  const user = await repo.findUserByEmail(email);

  // Always run comparePassword to prevent timing attacks on non-existent users
  const dummyHash = '$2b$12$invalidhashpadding000000000000000000000000000000000000000';
  const isValid = user
    ? await comparePassword(password, user.password_hash)
    : await comparePassword(password, dummyHash).then(() => false);

  if (!user || !isValid) {
    logger.warn({ msg: 'login_failed', traceId, email: maskEmail(email) });
    throw ApiError.unauthorized('Invalid email or password');
  }

  const familyId = uuidv4();
  const tokenId = uuidv4();
  const rawRefresh = signRefresh(buildRefreshPayload(user.id, familyId, tokenId));
  const tokenHash = sha256(rawRefresh);

  await repo.createRefreshToken({
    id: tokenId,
    user_id: user.id,
    token_hash: tokenHash,
    family_id: familyId,
    expires_at: refreshExpiresAt(),
  });

  logger.info({ msg: 'login_success', traceId, user_id: user.id, role: user.role });

  await auditService.record({
    actor: user,
    action: 'auth.login',
    entityType: 'user',
    entityId: user.id,
    changes: {},
    req,
  });

  const accessToken = signAccess(buildAccessPayload(user));
  return {
    user: { id: user.id, email: user.email, role: user.role },
    tokens: { accessToken, refreshToken: rawRefresh },
    // Flat aliases — kept for legacy curl/api consumers that haven't migrated.
    accessToken,
    refreshToken: rawRefresh,
  };
}

async function refresh(rawRefreshToken, traceId) {
  // Verify JWT structure first
  let decoded;
  try {
    decoded = verifyRefresh(rawRefreshToken);
  } catch {
    throw ApiError.unauthorized('Invalid or expired refresh token');
  }

  const tokenHash = sha256(rawRefreshToken);
  const storedToken = await repo.findRefreshToken(tokenHash);

  // Token not in DB at all
  if (!storedToken) {
    logger.warn({ msg: 'refresh_token_not_found', traceId, family: decoded.fam });
    throw ApiError.unauthorized('Refresh token not recognised');
  }

  // Reuse detection: token is already revoked — revoke entire family (stolen token scenario)
  if (storedToken.revoked_at !== null) {
    logger.warn({ msg: 'refresh_token_reuse_detected', traceId, family: decoded.fam });
    await repo.revokeFamilyTokens(storedToken.family_id);
    throw ApiError.unauthorized('Refresh token reuse detected — please log in again');
  }

  // Expired
  if (new Date() > storedToken.expires_at) {
    await repo.revokeRefreshToken(storedToken.id);
    throw ApiError.unauthorized('Refresh token expired');
  }

  // Revoke current token
  await repo.revokeRefreshToken(storedToken.id);

  const user = await repo.findUserById(storedToken.user_id);
  if (!user) throw ApiError.unauthorized('User no longer exists');

  // Issue new token in same family
  const newTokenId = uuidv4();
  const newRaw = signRefresh(buildRefreshPayload(user.id, storedToken.family_id, newTokenId));
  const newHash = sha256(newRaw);

  await repo.createRefreshToken({
    id: newTokenId,
    user_id: user.id,
    token_hash: newHash,
    family_id: storedToken.family_id,
    expires_at: refreshExpiresAt(),
  });

  logger.info({ msg: 'token_refreshed', traceId, user_id: user.id });

  const accessToken = signAccess(buildAccessPayload(user));
  return {
    tokens: { accessToken, refreshToken: newRaw },
    accessToken,
    refreshToken: newRaw,
  };
}

async function logout(userId, traceId, req) {
  await repo.revokeAllTokensForUser(userId);
  logger.info({ msg: 'logout', traceId, user_id: userId });

  await auditService.record({
    actor: { id: userId },
    action: 'auth.logout',
    entityType: 'user',
    entityId: userId,
    changes: {},
    req,
  });
}

async function getMe(userId) {
  const user = await repo.findUserById(userId);
  if (!user) throw ApiError.notFound('User not found');
  return user;
}

/**
 * Build the self-service account overview for the logged-in user's personal
 * panel: their own profile plus their own transaction history (planHistory).
 *
 * Strictly self-scoped — we resolve the user from their access token (userId),
 * read their email, and only ever return the Sumago mirror row that matches
 * that email. This is the server-side guarantee behind user-wise data
 * segregation: a user can never see another user's transactions, regardless of
 * what the client requests.
 *
 * Provisioned users whose Sumago mirror row hasn't synced yet simply get an
 * empty transaction list and a sparse profile (email/role/memberSince only).
 *
 * @param {string} userId
 * @returns {Promise<{ profile: object, transactions: object[] }>}
 */
async function getAccountOverview(userId) {
  const user = await repo.findUserById(userId);
  if (!user) throw ApiError.notFound('User not found');

  const sumago = await repo.findSumagoUserByEmail(user.email);

  const profile = {
    email:            user.email,
    role:             user.role,
    memberSince:      user.created_at,
    firstName:        sumago?.firstName ?? null,
    lastName:         sumago?.lastName ?? null,
    phoneNumber:      sumago?.phoneNumber ?? null,
    plan:             sumago?.plan ?? null,
    group:            sumago?.groupName ?? null,
    unit:             sumago?.unit ?? null,
    phase:            sumago?.phase ?? null,
    segment:          sumago?.segment ?? null,
    emailStatus:      sumago?.emailStatus ?? null,
    onboardingStatus: sumago?.onboardingStatus ?? null,
  };

  // Transactions come from two sources, merged:
  //   1. Sumago-synced planHistory (authoritative once the get-users sync runs).
  //   2. LOCAL Payment / paid-enrollment records — so a completed payment shows
  //      immediately, without waiting for the Sumago round-trip (which may lag
  //      or be unreachable). Deduped by transactionId, preferring the Sumago
  //      entry when the same transaction exists in both.
  const planHistory = Array.isArray(sumago?.planHistory) ? sumago.planHistory : [];
  const localTransactions = await buildLocalTransactions(user.email);

  const seenTxnIds = new Set(
    planHistory.map((t) => t?.transactionId).filter(Boolean),
  );
  const merged = [
    ...planHistory,
    ...localTransactions.filter((t) => !t.transactionId || !seenTxnIds.has(t.transactionId)),
  ];

  // Newest first. Entries carry an ISO `paymentDate`; entries with a
  // missing/invalid date sort to the bottom rather than throwing.
  const transactions = merged.sort(
    (a, b) => (Date.parse(b?.paymentDate) || 0) - (Date.parse(a?.paymentDate) || 0),
  );

  return { profile, transactions };
}

const PAID_ENROLLMENT_STATUSES = ['paid', 'sync_pending', 'completed'];

/**
 * Build transaction rows from LOCAL enrollment/payment records for an email,
 * matching the planHistory shape { paymentDate, amount, plan, transactionId }.
 *
 *   - One row per SUCCESSFUL Payment (amount/100 → whole rupees, txn id from the
 *     Razorpay payment/order id).
 *   - For a paid enrollment with NO successful payment (admin-created or
 *     fully-discounted), one row from the enrollment's snapshot amount.
 *
 * @param {string} email
 * @returns {Promise<Array<{paymentDate:string, amount:number, plan:string|null, transactionId:string, source:'local'}>>}
 */
async function buildLocalTransactions(email) {
  const enrollments = await repo.findEnrollmentsWithPaymentsByEmail(email);
  const toIso = (d) => (d instanceof Date ? d.toISOString() : (d || null));
  const rows = [];

  for (const e of enrollments) {
    const planName = e.internal_plan?.name || e.plan_pricing?.plan?.name || e.plan || null;
    const successPayments = (e.payments || []).filter((p) => p.status === 'success');

    if (successPayments.length > 0) {
      for (const p of successPayments) {
        rows.push({
          paymentDate:   toIso(p.created_at) || toIso(e.created_at),
          amount:        Math.round((p.amount || 0) / 100),
          plan:          planName,
          transactionId: p.razorpay_payment_id || p.razorpay_order_id || e.enrollment_code || e.id,
          source:        'local',
        });
      }
    } else if (PAID_ENROLLMENT_STATUSES.includes(e.status)) {
      const amountPaise = e.final_amount_paise != null ? e.final_amount_paise : (e.amount || 0);
      rows.push({
        paymentDate:   toIso(e.updated_at) || toIso(e.created_at),
        amount:        Math.round(amountPaise / 100),
        plan:          planName,
        transactionId: e.enrollment_code || e.id,
        source:        'local',
      });
    }
  }

  return rows;
}

/**
 * Change the authenticated user's password.
 *
 * Verifies `currentPassword` against the stored bcrypt hash, rejects if:
 *   - currentPassword does not match (INVALID_CURRENT_PASSWORD)
 *   - newPassword is the same as the current one (SAME_PASSWORD)
 *
 * On success:
 *   - Hashes newPassword with bcrypt (cost 12).
 *   - Updates password_hash in the database.
 *   - Revokes ALL refresh tokens for the user so every other device
 *     is forced to re-authenticate (security hygiene after credential change).
 *
 * @param {string} userId
 * @param {string} currentPassword
 * @param {string} newPassword
 * @param {string} traceId
 * @returns {Promise<{ success: boolean }>}
 */
async function changePassword(userId, currentPassword, newPassword, traceId) {
  // Load the user with their current hash.
  const user = await repo.findUserWithHashById(userId);
  if (!user) throw ApiError.notFound('User not found');

  // Verify the submitted current password.
  const currentMatches = await comparePassword(currentPassword, user.password_hash);
  if (!currentMatches) {
    logger.warn({ msg: 'change_password_wrong_current', traceId, user_id: userId });
    throw new ApiError(
      400,
      ERROR_CODES.INVALID_CURRENT_PASSWORD,
      'Current password is incorrect',
    );
  }

  // Guard against a no-op change (same password submitted as new).
  const sameAsNew = await comparePassword(newPassword, user.password_hash);
  if (sameAsNew) {
    throw new ApiError(
      400,
      ERROR_CODES.SAME_PASSWORD,
      'New password must differ from the current password',
    );
  }

  // Hash the new password and persist.
  const newHash = await hashPassword(newPassword);
  await repo.updatePassword(userId, newHash);

  // Revoke all refresh tokens — forces re-login on all other devices.
  await repo.revokeAllTokensForUser(userId);

  logger.info({ msg: 'password_changed', traceId, user_id: userId });

  return { success: true };
}

function maskEmail(email) {
  const [local, domain] = email.split('@');
  return `${local[0]}***@${domain}`;
}

module.exports = { login, refresh, logout, getMe, getAccountOverview, changePassword };
