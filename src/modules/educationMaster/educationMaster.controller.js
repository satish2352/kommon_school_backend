'use strict';

const educationMasterService = require('./educationMaster.service');
const { sendSuccess } = require('../../utils/ApiResponse');
const asyncHandler = require('../../utils/asyncHandler');
const { HTTP } = require('../../config/constants');

// ---------------------------------------------------------------------------
// GET /api/v1/education-master
// ---------------------------------------------------------------------------

const list = asyncHandler(async (req, res) => {
  const { rows, meta } = await educationMasterService.listEducationMasters(req.query, req.traceId);
  sendSuccess(res, HTTP.OK, rows, undefined, meta);
});

// ---------------------------------------------------------------------------
// GET /api/v1/education-master/:id
// ---------------------------------------------------------------------------

const getById = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const record = await educationMasterService.getEducationMasterById(id, req.traceId);
  sendSuccess(res, HTTP.OK, record);
});

// ---------------------------------------------------------------------------
// POST /api/v1/education-master
// ---------------------------------------------------------------------------

const create = asyncHandler(async (req, res) => {
  const record = await educationMasterService.createEducationMaster(req.body, req.traceId);
  sendSuccess(res, HTTP.CREATED, record, 'Education master record created');
});

// ---------------------------------------------------------------------------
// PATCH /api/v1/education-master/:id
// ---------------------------------------------------------------------------

const update = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const record = await educationMasterService.updateEducationMaster(id, req.body, req.traceId);
  sendSuccess(res, HTTP.OK, record, 'Education master record updated');
});

// ---------------------------------------------------------------------------
// DELETE /api/v1/education-master/:id
// ---------------------------------------------------------------------------

const remove = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  await educationMasterService.deleteEducationMaster(id, req.traceId);
  sendSuccess(res, HTTP.OK, { id }, 'Education master record deleted');
});

module.exports = { list, getById, create, update, remove };
