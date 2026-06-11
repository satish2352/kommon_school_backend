'use strict';

const { Router } = require('express');
const controller = require('./user.controller');
const { validate } = require('../../../middleware/validate.middleware');
const { authenticate } = require('../../../middleware/auth.middleware');
const { hasPermission } = require('../../../middleware/rbac.middleware');
const {
  createUserSchema,
  updateUserSchema,
  listUsersQuerySchema,
  idParamSchema,
} = require('./user.validator');
const { PERMISSIONS } = require('../../../config/constants');

const router = Router();

router.use(authenticate);
router.use(hasPermission(PERMISSIONS.USERS_MANAGE));

router.post('/', validate(createUserSchema, 'body'), controller.create);
router.get('/', validate(listUsersQuerySchema, 'query'), controller.list);
router.get('/:id', validate(idParamSchema, 'params'), controller.getById);
router.patch('/:id', validate(idParamSchema, 'params'), validate(updateUserSchema, 'body'), controller.update);
router.delete('/:id', validate(idParamSchema, 'params'), controller.remove);
// Reactivate a soft-deleted user. Sibling to DELETE — pair them so the
// admin UI can toggle Active/Inactive without writing two flows.
router.post('/:id/reactivate', validate(idParamSchema, 'params'), controller.reactivate);

module.exports = router;
