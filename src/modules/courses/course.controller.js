'use strict';

/**
 * Course Master Controller
 *
 * All endpoints require admin authentication.
 *
 * Sample response shapes:
 *
 * GET /api/v1/courses?page=1&limit=10
 * {
 *   "success": true,
 *   "data": [
 *     {
 *       "id": 1,
 *       "nameOfCourseAsGroup": "Data Science and AIML",
 *       "coupon": "EARLYBIRD20",
 *       "courseFee": "49999.00",
 *       "description": "Comprehensive program covering Python, ML, and deep learning.",
 *       "duration": "6 months",
 *       "status": "ACTIVE",
 *       "createdAt": "2026-05-09T10:00:00.000Z",
 *       "updatedAt": "2026-05-09T10:00:00.000Z"
 *     }
 *   ],
 *   "meta": { "page": 1, "limit": 10, "total": 7, "totalPages": 1 }
 * }
 */

const courseService = require('./course.service');
const { sendSuccess } = require('../../utils/ApiResponse');
const asyncHandler = require('../../utils/asyncHandler');
const { HTTP } = require('../../config/constants');

// ---------------------------------------------------------------------------
// GET /api/v1/courses
// ---------------------------------------------------------------------------

const list = asyncHandler(async (req, res) => {
  const { rows, meta } = await courseService.listCourses(req.query, req.traceId);
  sendSuccess(res, HTTP.OK, rows, undefined, meta);
});

// ---------------------------------------------------------------------------
// GET /api/v1/courses/:id
// ---------------------------------------------------------------------------

const getById = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const course = await courseService.getCourseById(id, req.traceId);
  sendSuccess(res, HTTP.OK, course);
});

// ---------------------------------------------------------------------------
// POST /api/v1/courses
// ---------------------------------------------------------------------------

const create = asyncHandler(async (req, res) => {
  const course = await courseService.createCourse(req.body, req.traceId);
  sendSuccess(res, HTTP.CREATED, course, 'Course created');
});

// ---------------------------------------------------------------------------
// PATCH /api/v1/courses/:id
// ---------------------------------------------------------------------------

const update = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const course = await courseService.updateCourse(id, req.body, req.traceId);
  sendSuccess(res, HTTP.OK, course, 'Course updated');
});

// ---------------------------------------------------------------------------
// DELETE /api/v1/courses/:id
// ---------------------------------------------------------------------------

const remove = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  await courseService.deleteCourse(id, req.traceId);
  sendSuccess(res, HTTP.OK, { id }, 'Course deleted');
});

module.exports = { list, getById, create, update, remove };
