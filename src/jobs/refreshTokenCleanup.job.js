'use strict';

/**
 * Refresh Token Cleanup Job
 * Schedule: 0 3 * * *  (daily at 03:00)
 *
 * Hard-deletes RefreshToken rows that are both:
 *   - Expired or revoked (expires_at < now OR revoked_at IS NOT NULL), AND
 *   - At least REFRESH_TOKEN_CLEANUP_RETENTION_DAYS old (default 30 days)
 *
 * The age guard preserves recent revoked tokens for a 30-day audit window so
 * operators can investigate suspicious refresh-token reuse before the evidence
 * is deleted.
 *
 * Returns { deleted } count for structured job logging.
 */

const { getPrismaClient } = require('../config/database');

const RETENTION_DAYS = parseInt(process.env.REFRESH_TOKEN_CLEANUP_RETENTION_DAYS || '30', 10);

async function run() {
  const db = getPrismaClient();

  const retentionCutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const now = new Date();

  const result = await db.refreshToken.deleteMany({
    where: {
      AND: [
        {
          OR: [
            { revoked_at: { not: null } },
            { expires_at: { lt: now } },
          ],
        },
        { created_at: { lt: retentionCutoff } },
      ],
    },
  });

  return { deleted: result.count };
}

module.exports = { run };
