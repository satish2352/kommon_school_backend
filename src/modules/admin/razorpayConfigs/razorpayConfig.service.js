'use strict';

const repo = require('./razorpayConfig.repository');
const auditService = require('../../audit/audit.service');
const { encrypt } = require('../../../utils/crypto');
const ApiError = require('../../../utils/ApiError');
const logger = require('../../../config/logger');
const { parsePagination, buildMeta } = require('../../../utils/pagination');
const { ERROR_CODES } = require('../../../config/constants');

const ALLOWED_SORT_FIELDS = ['created_at', 'updated_at'];

/**
 * Create a new Razorpay config. key_secret and webhook_secret are encrypted at
 * rest. is_active defaults to false — superadmin must explicitly activate.
 *
 * @param {{ body: object, actor: object, req: object }} opts
 * @returns {Promise<object>} masked config
 */
async function createConfig({ body, actor, req }) {
  const data = {
    key_id: body.key_id,
    key_secret_encrypted: encrypt(body.key_secret),
    webhook_secret_encrypted: encrypt(body.webhook_secret),
    is_active: false,
  };

  const config = await repo.createConfig(data);

  logger.info({ msg: 'razorpay_config_created', config_id: config.id });

  await auditService.record({
    actor,
    action: 'razorpay_config.create',
    entityType: 'razorpay_configuration',
    entityId: config.id,
    changes: { key_id: body.key_id },
    req,
  });

  return config;
}

/**
 * Paginated list — never exposes encrypted secrets.
 *
 * @param {object} query
 * @param {string} traceId
 * @returns {Promise<{ rows: object[], meta: object }>}
 */
async function listConfigs(query, traceId) {
  const { page, limit, skip, sortOrder } = parsePagination(query);
  const sortBy = ALLOWED_SORT_FIELDS.includes(query.sortBy) ? query.sortBy : 'created_at';

  const { rows, total } = await repo.listConfigs({
    skip,
    take: limit,
    where: {},
    orderBy: { [sortBy]: sortOrder },
  });

  logger.info({ msg: 'razorpay_configs_listed', traceId, total });

  return { rows, meta: buildMeta(page, limit, total) };
}

/**
 * Get a single config by ID (masked).
 *
 * @param {string} id
 * @returns {Promise<object>}
 */
async function getConfigById(id) {
  const config = await repo.findConfigById(id);
  if (!config) {
    throw ApiError.notFound('Razorpay configuration not found');
  }
  return config;
}

/**
 * Atomically activate a config (deactivates all others).
 *
 * @param {{ id: string, actor: object, req: object }} opts
 * @returns {Promise<object>} masked active config
 */
async function activateConfig({ id, actor, req }) {
  const existing = await repo.findConfigById(id);
  if (!existing) {
    throw ApiError.notFound('Razorpay configuration not found');
  }

  const activated = await repo.setActiveConfig(id);

  logger.info({ msg: 'razorpay_config_activated', config_id: id });

  await auditService.record({
    actor,
    action: 'razorpay_config.activate',
    entityType: 'razorpay_configuration',
    entityId: id,
    changes: { key_id: existing.key_id },
    req,
  });

  return activated;
}

/**
 * Hard-delete a config. Refuses if the config is currently active.
 *
 * @param {{ id: string, actor: object, req: object }} opts
 */
async function deleteConfig({ id, actor, req }) {
  const existing = await repo.findConfigById(id);
  if (!existing) {
    throw ApiError.notFound('Razorpay configuration not found');
  }

  if (existing.is_active) {
    throw new ApiError(
      409,
      ERROR_CODES.CANNOT_DELETE_ACTIVE,
      'Cannot delete the currently active Razorpay configuration. Activate another config first.',
    );
  }

  await repo.deleteConfig(id);

  logger.info({ msg: 'razorpay_config_deleted', config_id: id });

  await auditService.record({
    actor,
    action: 'razorpay_config.delete',
    entityType: 'razorpay_configuration',
    entityId: id,
    changes: null,
    req,
  });
}

module.exports = { createConfig, listConfigs, getConfigById, activateConfig, deleteConfig };
