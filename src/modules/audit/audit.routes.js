'use strict';

const { Router } = require('express');
const controller = require('./audit.controller');
const { validate } = require('../../middleware/validate.middleware');
const { authenticate } = require('../../middleware/auth.middleware');
const { hasPermission } = require('../../middleware/rbac.middleware');
const { listAuditLogQuerySchema } = require('./audit.validator');
const { PERMISSIONS } = require('../../config/constants');

const router = Router();

router.use(authenticate);
router.use(hasPermission(PERMISSIONS.AUDIT_LOGS_VIEW));

/**
 * GET /api/v1/audit-logs
 * Paginated list of audit events. Supports filtering by action, entityType,
 * entityId, actorId, dateFrom, dateTo, and full-text search.
 */
router.get('/', validate(listAuditLogQuerySchema, 'query'), controller.list);

module.exports = router;
