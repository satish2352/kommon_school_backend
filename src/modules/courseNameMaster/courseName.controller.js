'use strict';

const courseNameService = require('./courseName.service');
const { sendSuccess } = require('../../utils/ApiResponse');
const asyncHandler = require('../../utils/asyncHandler');
const { HTTP } = require('../../config/constants');

// ---------------------------------------------------------------------------
// GET /api/v1/admin/course-names
// ---------------------------------------------------------------------------

const list = asyncHandler(async (req, res) => {
  const { rows, meta } = await courseNameService.listCourseNames(req.query, req.traceId);
  sendSuccess(res, HTTP.OK, rows, undefined, meta);
});

// ---------------------------------------------------------------------------
// GET /api/v1/admin/course-names/:id
// ---------------------------------------------------------------------------

const getById = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const record = await courseNameService.getCourseNameById(id, req.traceId);
  sendSuccess(res, HTTP.OK, record);
});

// ---------------------------------------------------------------------------
// POST /api/v1/admin/course-names
// ---------------------------------------------------------------------------

const create = asyncHandler(async (req, res) => {
  const record = await courseNameService.createCourseName(req.body, req.traceId);
  sendSuccess(res, HTTP.CREATED, record, 'Course name created');
});

// ---------------------------------------------------------------------------
// PATCH /api/v1/admin/course-names/:id
// ---------------------------------------------------------------------------

const update = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const record = await courseNameService.updateCourseName(id, req.body, req.traceId);
  sendSuccess(res, HTTP.OK, record, 'Course name updated');
});

// ---------------------------------------------------------------------------
// DELETE /api/v1/admin/course-names/:id
// ---------------------------------------------------------------------------

const remove = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  await courseNameService.deleteCourseName(id, req.traceId);
  sendSuccess(res, HTTP.OK, { id }, 'Course name deleted');
});

module.exports = { list, getById, create, update, remove };
