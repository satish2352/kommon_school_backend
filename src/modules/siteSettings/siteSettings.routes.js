'use strict';

const { Router } = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const controller = require('./siteSettings.controller');
const { validate } = require('../../middleware/validate.middleware');
const { authenticate } = require('../../middleware/auth.middleware');
const { authorize } = require('../../middleware/rbac.middleware');
const { updateSettingsSchema } = require('./siteSettings.validator');

const router = Router();

// Logos are written to backend/uploads/branding and served statically by app.js
// at /uploads. Created on boot so the first upload doesn't fail.
const UPLOAD_DIR = path.join(__dirname, '..', '..', '..', 'uploads', 'branding');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_MIME = [
  'image/png', 'image/jpeg', 'image/jpg', 'image/webp',
  'image/svg+xml', 'image/x-icon', 'image/vnd.microsoft.icon',
];

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = (path.extname(file.originalname) || '.png').toLowerCase();
    cb(null, `logo-${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only image files (PNG, JPG, SVG, WEBP, ICO) are allowed.'));
  },
});

// Public — website + admin read branding without auth.
router.get('/', controller.getPublic);

// Admin/superadmin — update brand name + upload logo.
router.put('/', authenticate, authorize(['admin', 'superadmin']), validate(updateSettingsSchema, 'body'), controller.update);
router.post('/logo', authenticate, authorize(['admin', 'superadmin']), upload.single('logo'), controller.uploadLogo);

module.exports = router;
