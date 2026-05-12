'use strict';

const { Router } = require('express');
const multer = require('multer');
const controller = require('./adminEnrollment.controller');
const { validate } = require('../../middleware/validate.middleware');
const { authenticate } = require('../../middleware/auth.middleware');
const { hasPermission } = require('../../middleware/rbac.middleware');
const { manualEnrollmentSchema } = require('./adminEnrollment.validator');
const { PERMISSIONS } = require('../../config/constants');

const router = Router();

// All admin enrollment routes require authentication
router.use(authenticate);

// Multer — memory storage, 2 MB file size limit
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB
  fileFilter: (_req, file, cb) => {
    if (
      file.mimetype === 'text/csv' ||
      file.mimetype === 'application/vnd.ms-excel' ||
      file.originalname.endsWith('.csv')
    ) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are accepted'), false);
    }
  },
});

// ---------------------------------------------------------------------------
// POST /manual — single enrollment without Razorpay
// ---------------------------------------------------------------------------
router.post(
  '/manual',
  hasPermission(PERMISSIONS.ENROLLMENTS_MANUAL_CREATE),
  validate(manualEnrollmentSchema, 'body'),
  controller.createManual,
);

// ---------------------------------------------------------------------------
// POST /bulk — CSV bulk upload
// ---------------------------------------------------------------------------
router.post(
  '/bulk',
  hasPermission(PERMISSIONS.ENROLLMENTS_BULK_UPLOAD),
  upload.single('file'),
  controller.createBulk,
);

// ---------------------------------------------------------------------------
// GET /csv-template — downloadable CSV template
// ---------------------------------------------------------------------------
router.get(
  '/csv-template',
  hasPermission(PERMISSIONS.ENROLLMENTS_BULK_UPLOAD),
  controller.getCsvTemplate,
);

module.exports = router;
