'use strict';

const { Router } = require('express');
const controller = require('./employeeLead.controller');
const { validate } = require('../../../middleware/validate.middleware');
const { authenticate } = require('../../../middleware/auth.middleware');
const { hasPermission } = require('../../../middleware/rbac.middleware');
const { PERMISSIONS } = require('../../../config/constants');
const {
  listLeadsQuerySchema,
  enrollmentIdParamSchema,
  addNoteSchema,
  updateStatusSchema,
} = require('./employeeLead.validator');

const router = Router();

router.use(authenticate);

// Permission gate. LEADS_VIEW_OWN is the foundational employee perm
// granted by the 'employee' role; admins / superadmins also have it via
// LEADS_VIEW_ALL implicitly because superadmin bypasses permission checks.
// The per-row ownership check (assigned_to == req.user.id) is enforced
// inside the service, NOT at this middleware layer, because admins are
// allowed to invoke the same endpoint for cross-employee monitoring.
router.use(hasPermission(PERMISSIONS.LEADS_VIEW_OWN));

router.get(
  '/',
  validate(listLeadsQuerySchema, 'query'),
  controller.list,
);

router.get(
  '/:enrollmentId',
  validate(enrollmentIdParamSchema, 'params'),
  controller.detail,
);

router.post(
  '/:enrollmentId/notes',
  validate(enrollmentIdParamSchema, 'params'),
  validate(addNoteSchema, 'body'),
  controller.addNote,
);

router.patch(
  '/:enrollmentId/status',
  validate(enrollmentIdParamSchema, 'params'),
  validate(updateStatusSchema, 'body'),
  controller.updateStatus,
);

module.exports = router;
