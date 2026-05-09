'use strict';

const repo = require('./audit.repository');
const logger = require('../../config/logger');
const { parsePagination, buildMeta } = require('../../utils/pagination');

const ALLOWED_SORT_FIELDS = ['created_at'];

/**
 * Record an audit event. Never throws — all errors are caught and logged so
 * audit failures do not break the caller.
 *
 * @param {{ actor?: object, action: string, entityType: string, entityId?: string,
 *           changes?: object, req?: import('express').Request }} opts
 */
async function record({ actor, action, entityType, entityId, changes, req }) {
  try {
    const data = {
      action,
      entity_type: entityType,
    };

    if (actor) {
      data.actor_id = actor.id || null;
      data.actor_email = actor.email || null;
    }

    if (entityId) {
      data.entity_id = entityId;
    }

    if (changes !== undefined) {
      data.changes = changes;
    }

    if (req) {
      data.ip_address = req.ip ? String(req.ip).slice(0, 64) : null;
      data.user_agent = req.headers && req.headers['user-agent']
        ? String(req.headers['user-agent']).slice(0, 500)
        : null;
      data.trace_id = req.traceId || null;
    }

    await repo.createAuditLog(data);
  } catch (err) {
    logger.error({
      msg: 'audit_log_write_failed',
      action,
      entity_type: entityType,
      error: err.message,
    });
  }
}

/**
 * Paginated list of audit logs.
 *
 * @param {object} query  — raw req.query
 * @param {string} traceId
 * @returns {Promise<{ rows: object[], meta: object }>}
 */
async function listAuditLogs(query, traceId) {
  const { page, limit, skip, sortOrder, dateFrom, dateTo } = parsePagination(query);

  const sortBy = ALLOWED_SORT_FIELDS.includes(query.sortBy) ? query.sortBy : 'created_at';

  const where = {};

  if (query.action) {
    where.action = query.action;
  }

  if (query.entityType) {
    where.entity_type = query.entityType;
  }

  if (query.entityId) {
    where.entity_id = query.entityId;
  }

  if (query.actorId) {
    where.actor_id = query.actorId;
  }

  if (dateFrom || dateTo) {
    where.created_at = {};
    if (dateFrom) where.created_at.gte = dateFrom;
    if (dateTo) where.created_at.lte = dateTo;
  }

  if (query.search) {
    const term = query.search.trim();
    where.OR = [
      { action: { contains: term, mode: 'insensitive' } },
      { entity_type: { contains: term, mode: 'insensitive' } },
      { actor_email: { contains: term, mode: 'insensitive' } },
    ];
  }

  const { rows, total } = await repo.listAuditLogs({
    skip,
    take: limit,
    where,
    orderBy: { [sortBy]: sortOrder },
  });

  logger.info({ msg: 'audit_logs_listed', traceId, total, page, limit });

  return { rows, meta: buildMeta(page, limit, total) };
}

module.exports = { record, listAuditLogs };
