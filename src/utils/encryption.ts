/**
 * AES-256-GCM symmetric encryption for secrets stored at rest.
 *
 * Algorithm: AES-256-GCM (authenticated encryption — provides both
 * confidentiality and integrity/authenticity).
 *
 * Format of ciphertext (base64):  iv:authTag:encrypted
 *   - iv       — 12 random bytes (96 bits, GCM standard)
 *   - authTag  — 16 bytes (128-bit GCM authentication tag)
 *   - encrypted — ciphertext bytes
 *
 * Key: 32-byte key derived from CONFIG_ENCRYPTION_KEY (64 hex chars).
 */

import crypto from 'crypto';
import { env } from '@/config/env';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;   // 96-bit IV — NIST recommended for GCM
const TAG_LENGTH = 16;  // 128-bit auth tag

function getKey(): Buffer {
  const keyHex = env.CONFIG_ENCRYPTION_KEY;
  if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) {
    throw new Error(
      'CONFIG_ENCRYPTION_KEY must be 64 hex characters. ' +
      'Generate with: openssl rand -hex 32',
    );
  }
  return Buffer.from(keyHex, 'hex');
}

/**
 * Encrypt a plaintext string.
 * Returns a base64-encoded string in the format: iv:authTag:ciphertext
 */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    iv.toString('base64'),
    authTag.toString('base64'),
    encrypted.toString('base64'),
  ].join(':');
}

/**
 * Decrypt a ciphertext string produced by encrypt().
 * Throws on tampered data (GCM authentication failure).
 */
export function decrypt(ciphertext: string): string {
  const key = getKey();
  const parts = ciphertext.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid ciphertext format — expected iv:authTag:encrypted');
  }

  const [ivB64, tagB64, encB64] = parts as [string, string, string];
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(tagB64, 'base64');
  const encrypted = Buffer.from(encB64, 'base64');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(authTag);

  try {
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    throw new Error('Decryption failed — data may be tampered or key may be incorrect');
  }
}

/**
 * Mask a secret for display: show first 4 and last 4 chars, replace middle with ***.
 * E.g. "rzp_test_abcdefgh" → "rzp_***_efgh"
 */
export function maskSecret(value: string): string {
  if (!value || value.length <= 8) return '***';
  return `${value.slice(0, 4)}***${value.slice(-4)}`;
}

/**
 * Returns true if the value looks like it is already encrypted
 * (contains exactly two colons separating base64 segments).
 */
export function isEncrypted(value: string): boolean {
  const parts = value.split(':');
  if (parts.length !== 3) return false;
  return parts.every((p) => /^[A-Za-z0-9+/=]+$/.test(p));
}
