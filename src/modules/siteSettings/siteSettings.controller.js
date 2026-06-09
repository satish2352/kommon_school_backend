'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const ApiError = require('../../utils/ApiError');
const { sendSuccess } = require('../../utils/ApiResponse');
const { HTTP } = require('../../config/constants');
const service = require('./siteSettings.service');

const shape = (s) => ({ brandName: s.brandName, logoUrl: s.logoUrl ?? null });

// GET /api/v1/settings — public. Powers the dynamic brand name + logo across
// the website, admin panel, and emails.
const getPublic = asyncHandler(async (req, res) => {
  const s = await service.getSettings();
  sendSuccess(res, HTTP.OK, shape(s));
});

// PUT /api/v1/settings — admin/superadmin. Update the brand name.
const update = asyncHandler(async (req, res) => {
  const s = await service.updateSettings({ brandName: req.body.brandName });
  sendSuccess(res, HTTP.OK, shape(s), 'Branding updated');
});

// POST /api/v1/settings/logo — admin/superadmin. Upload a new logo (multipart,
// field "logo"). Stores the file on disk and saves its public path.
const uploadLogo = asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest('No logo file uploaded. Use field name "logo".');
  const logoUrl = `/uploads/branding/${req.file.filename}`;
  const s = await service.updateSettings({ logoUrl });
  sendSuccess(res, HTTP.OK, shape(s), 'Logo updated');
});

module.exports = { getPublic, update, uploadLogo };
