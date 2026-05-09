'use strict';

const { Router } = require('express');
const controller = require('./followup.controller');
const { validate } = require('../../middleware/validate.middleware');
const { authenticate } = require('../../middleware/auth.middleware');
const { hasPermission } = require('../../middleware/rbac.middleware');
const {
  listFollowupsQuerySchema,
  updateStatusSchema,
  addNoteSchema,
  idParamSchema,
} = require('./followup.validator');
const { PERMISSIONS } = require('../../config/constants');

const router = Router();

// All followup routes require authentication — permissions are checked per-route.
router.use(authenticate);

/**
 * GET /api/v1/followups
 * List followups — read-only, requires followups:view.
 */
router.get(
  '/',
  hasPermission(PERMISSIONS.FOLLOWUPS_VIEW),
  validate(listFollowupsQuerySchema, 'query'),
  controller.list,
);

/**
 * GET /api/v1/followups/:id/timeline
 * Return a followup with its synthesized timeline — read-only, requires followups:view.
 */
router.get(
  '/:id/timeline',
  hasPermission(PERMISSIONS.FOLLOWUPS_VIEW),
  validate(idParamSchema, 'params'),
  controller.getTimeline,
);

/**
 * POST /api/v1/followups/:id/notes
 * Append a note to a followup — mutating, requires followups:manage.
 */
router.post(
  '/:id/notes',
  hasPermission(PERMISSIONS.FOLLOWUPS_MANAGE),
  validate(idParamSchema, 'params'),
  validate(addNoteSchema, 'body'),
  controller.addNote,
);

/**
 * PATCH /api/v1/followups/:id/status
 * Update followup status — mutating, requires followups:manage.
 */
router.patch(
  '/:id/status',
  hasPermission(PERMISSIONS.FOLLOWUPS_MANAGE),
  validate(idParamSchema, 'params'),
  validate(updateStatusSchema, 'body'),
  controller.updateStatus,
);

/**
 * POST /api/v1/followups/:id/retry-payment
 * Trigger a payment retry for the enrollment linked to this followup.
 * Mutating, requires followups:manage.
 */
router.post(
  '/:id/retry-payment',
  hasPermission(PERMISSIONS.FOLLOWUPS_MANAGE),
  validate(idParamSchema, 'params'),
  controller.retryPayment,
);

module.exports = router;
