'use strict';

const { Router } = require('express');
const controller = require('./contact.controller');
const { validate } = require('../../middleware/validate.middleware');
const { createContactSchema } = require('./contact.validator');

const router = Router();

// POST /api/v1/contact — public "Send Us a Message" submission (no auth).
router.post('/', validate(createContactSchema), controller.submit);

module.exports = router;
