'use strict';

const service = require('./internalPlan.service');
const { sendSuccess } = require('../../utils/ApiResponse');
const asyncHandler = require('../../utils/asyncHandler');
const { HTTP } = require('../../config/constants');

// ---------------------------------------------------------------------------
// GET /api/v1/admin/internal-plans
// ---------------------------------------------------------------------------

const list = asyncHandler(async (req, res) => {
  const { rows, meta } = await service.listInternalPlans(req.query, req.traceId);
  sendSuccess(res, HTTP.OK, rows, undefined, meta);
});

// ---------------------------------------------------------------------------
// GET /api/v1/admin/internal-plans/by-course/:courseId
// NOTE: must be registered BEFORE /:id to avoid Express param conflict.
// ---------------------------------------------------------------------------

const listByCourse = asyncHandler(async (req, res) => {
  const courseId = parseInt(req.params.courseId, 10);
  const plans = await service.listByCourse(courseId, req.traceId);
  sendSuccess(res, HTTP.OK, plans);
});

// ---------------------------------------------------------------------------
// POST /api/v1/admin/internal-plans/validate-coupon
// NOTE: registered before /:id routes to avoid param conflict.
// ---------------------------------------------------------------------------

const validateCoupon = asyncHandler(async (req, res) => {
  const { code, internalPlanId, basePrice } = req.body;
  const result = await service.validateCoupon({ code, internalPlanId, basePrice }, req.traceId);
  sendSuccess(res, HTTP.OK, result);
});

// ---------------------------------------------------------------------------
// POST /api/v1/admin/internal-plans/calculate-fee
// NOTE: registered before /:id routes to avoid param conflict.
// ---------------------------------------------------------------------------

const calculateFee = asyncHandler(async (req, res) => {
  const { internalPlanId, basePrice, couponCode } = req.body;
  const result = await service.calculateFee({ internalPlanId, basePrice, couponCode }, req.traceId);
  sendSuccess(res, HTTP.OK, result);
});

// ---------------------------------------------------------------------------
// GET /api/v1/admin/internal-plans/:id
// ---------------------------------------------------------------------------

const getById = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const plan = await service.getInternalPlanById(id, req.traceId);
  sendSuccess(res, HTTP.OK, plan);
});

// ---------------------------------------------------------------------------
// POST /api/v1/admin/internal-plans
// ---------------------------------------------------------------------------

const create = asyncHandler(async (req, res) => {
  const plan = await service.createInternalPlan(req.body, req.traceId);
  sendSuccess(res, HTTP.CREATED, plan, 'Internal plan created');
});

// ---------------------------------------------------------------------------
// PATCH /api/v1/admin/internal-plans/:id/status
// NOTE: registered BEFORE /:id PATCH to avoid param conflict.
// ---------------------------------------------------------------------------

const setStatus = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const plan = await service.setInternalPlanStatus(id, req.body.status, req.traceId);
  sendSuccess(res, HTTP.OK, plan, 'Status updated');
});

// ---------------------------------------------------------------------------
// PATCH /api/v1/admin/internal-plans/:id
// ---------------------------------------------------------------------------

const update = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const plan = await service.updateInternalPlan(id, req.body, req.traceId);
  sendSuccess(res, HTTP.OK, plan, 'Internal plan updated');
});

// ---------------------------------------------------------------------------
// DELETE /api/v1/admin/internal-plans/:id
// ---------------------------------------------------------------------------

const remove = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  await service.deleteInternalPlan(id, req.traceId);
  res.status(HTTP.OK).json({ success: true, data: { id } });
});

module.exports = {
  list,
  listByCourse,
  validateCoupon,
  calculateFee,
  getById,
  create,
  setStatus,
  update,
  remove,
};
