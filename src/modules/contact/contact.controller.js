'use strict';

const contactService = require('./contact.service');
const { sendSuccess } = require('../../utils/ApiResponse');
const asyncHandler = require('../../utils/asyncHandler');
const { HTTP } = require('../../config/constants');

// ---------------------------------------------------------------------------
// POST /api/v1/contact  (public)
// ---------------------------------------------------------------------------
const submit = asyncHandler(async (req, res) => {
  const record = await contactService.createSubmission(
    {
      ...req.body,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    },
    req.traceId,
  );
  sendSuccess(res, HTTP.CREATED, { id: record.id }, 'Thanks! Your message has been received.');
});

// ---------------------------------------------------------------------------
// GET /api/v1/admin/contact-messages  (admin)
// ---------------------------------------------------------------------------
const list = asyncHandler(async (req, res) => {
  const { rows, meta } = await contactService.listSubmissions(req.query, req.traceId);
  sendSuccess(res, HTTP.OK, rows, undefined, meta);
});

// ---------------------------------------------------------------------------
// PATCH /api/v1/admin/contact-messages/:id/status  (admin)
// ---------------------------------------------------------------------------
const updateStatus = asyncHandler(async (req, res) => {
  const record = await contactService.updateStatus(req.params.id, req.body.status, req.traceId);
  sendSuccess(res, HTTP.OK, record, 'Status updated');
});

module.exports = { submit, list, updateStatus };
