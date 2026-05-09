'use strict';

const crypto = require('crypto');
const bcrypt = require('bcrypt');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit IV recommended for GCM
const TAG_LENGTH = 16;
const BCRYPT_ROUNDS = 12;

/**
 * Derive the 32-byte key from the hex master key env var.
 * Called lazily so env is loaded before first use.
 */
function getMasterKey() {
  const hex = process.env.ENCRYPTION_MASTER_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error('ENCRYPTION_MASTER_KEY must be a 64-character hex string (32 bytes)');
  }
  return Buffer.from(hex, 'hex');
}

/**
 * Encrypt plaintext with AES-256-GCM.
 * Returns a colon-separated string: iv:authTag:ciphertext (all hex).
 * @param {string} plaintext
 * @returns {string}
 */
function encrypt(plaintext) {
  const key = getMasterKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypt an AES-256-GCM ciphertext produced by encrypt().
 * @param {string} encryptedString - iv:authTag:ciphertext (hex)
 * @returns {string}
 */
function decrypt(encryptedString) {
  const key = getMasterKey();
  const parts = encryptedString.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted string format');
  const [ivHex, tagHex, dataHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(tagHex, 'hex');
  const ciphertext = Buffer.from(dataHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/**
 * HMAC-SHA256 of message with secret. Returns hex digest.
 * @param {string} message
 * @param {string} secret
 * @returns {string}
 */
function hmacSha256(message, secret) {
  return crypto.createHmac('sha256', secret).update(message).digest('hex');
}

/**
 * Timing-safe comparison of two strings.
 * Returns true if equal.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function timingSafeEqual(a, b) {
  try {
    const bufA = Buffer.from(a, 'utf8');
    const bufB = Buffer.from(b, 'utf8');
    if (bufA.length !== bufB.length) {
      // Still run through the comparison to avoid timing leak on length
      crypto.timingSafeEqual(bufA, bufA);
      return false;
    }
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

/**
 * SHA-256 hash of input. Used for refresh token storage.
 * @param {string} input
 * @returns {string} hex digest
 */
function sha256(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

/**
 * Hash a password with bcrypt.
 * @param {string} password
 * @returns {Promise<string>}
 */
async function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

/**
 * Compare a plaintext password against a bcrypt hash.
 * @param {string} password
 * @param {string} hash
 * @returns {Promise<boolean>}
 */
async function comparePassword(password, hash) {
  return bcrypt.compare(password, hash);
}

module.exports = {
  encrypt,
  decrypt,
  hmacSha256,
  timingSafeEqual,
  sha256,
  hashPassword,
  comparePassword,
};
