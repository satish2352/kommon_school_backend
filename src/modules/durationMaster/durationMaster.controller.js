'use strict';

const durationMasterService = require('./durationMaster.service');
const { sendSuccess } = require('../../utils/ApiResponse');
const asyncHandler = require('../../utils/asyncHandler');
const { HTTP } = require('../../config/constants');

// ---------------------------------------------------------------------------
// GET /api/v1/duration-master
// ---------------------------------------------------------------------------

const list = asyncHandler(async (req, res) => {
  const { rows, meta } = await durationMasterService.listDurationMasters(req.query, req.traceId);
  sendSuccess(res, HTTP.OK, rows, undefined, meta);
});

// ---------------------------------------------------------------------------
// GET /api/v1/duration-master/:id
// ---------------------------------------------------------------------------

const getById = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const record = await durationMasterService.getDurationMasterById(id, req.traceId);
  sendSuccess(res, HTTP.OK, record);
});

// ---------------------------------------------------------------------------
// POST /api/v1/duration-master
// ---------------------------------------------------------------------------

const create = asyncHandler(async (req, res) => {
  const record = await durationMasterService.createDurationMaster(req.body, req.traceId);
  sendSuccess(res, HTTP.CREATED, record, 'Duration master record created');
});

// ---------------------------------------------------------------------------
// PATCH /api/v1/duration-master/:id
// ---------------------------------------------------------------------------

const update = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const record = await durationMasterService.updateDurationMaster(id, req.body, req.traceId);
  sendSuccess(res, HTTP.OK, record, 'Duration master record updated');
});

// ---------------------------------------------------------------------------
// DELETE /api/v1/duration-master/:id
// ---------------------------------------------------------------------------

const remove = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  await durationMasterService.deleteDurationMaster(id, req.traceId);
  sendSuccess(res, HTTP.OK, { id }, 'Duration master record deleted');
});

module.exports = { list, getById, create, update, remove };
