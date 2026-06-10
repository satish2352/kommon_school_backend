'use strict';

const planService = require('./plan.service');
const { sendSuccess } = require('../../utils/ApiResponse');
const asyncHandler = require('../../utils/asyncHandler');
const { HTTP } = require('../../config/constants');

// ---------------------------------------------------------------------------
// Public — GET /api/v1/plans
// ---------------------------------------------------------------------------

const listPublic = asyncHandler(async (req, res) => {
  const plans = await planService.listPublic(req.traceId);
  sendSuccess(res, HTTP.OK, plans);
});

// ---------------------------------------------------------------------------
// Public — GET /api/v1/plans/:id
// ---------------------------------------------------------------------------

const getPublicById = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const plan = await planService.getById(id, req.traceId);
  sendSuccess(res, HTTP.OK, plan);
});

// ---------------------------------------------------------------------------
// Public — PATCH /api/v1/enrollments/:id/plan
// ---------------------------------------------------------------------------

const selectPlan = asyncHandler(async (req, res) => {
  const enrollmentId = req.params.id;
  const { planPricingId } = req.body;
  const { enrollment, planPricing } = await planService.selectForEnrollment(
    enrollmentId,
    planPricingId,
    req.traceId,
  );
  sendSuccess(res, HTTP.OK, { enrollment, planPricing }, 'Plan selected');
});

// ---------------------------------------------------------------------------
// Admin — GET /api/v1/admin/plans
// ---------------------------------------------------------------------------

const listAdmin = asyncHandler(async (req, res) => {
  const { rows, meta } = await planService.listAdmin(req.query, req.traceId);
  sendSuccess(res, HTTP.OK, rows, undefined, meta);
});

// ---------------------------------------------------------------------------
// Admin — GET /api/v1/admin/plans/:id
// ---------------------------------------------------------------------------

const getAdminById = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const plan = await planService.getById(id, req.traceId);
  sendSuccess(res, HTTP.OK, plan);
});

// ---------------------------------------------------------------------------
// Admin — POST /api/v1/admin/plans
// ---------------------------------------------------------------------------

const create = asyncHandler(async (req, res) => {
  const plan = await planService.create(req.body, req.traceId);
  sendSuccess(res, HTTP.CREATED, plan, 'Plan created');
});

// ---------------------------------------------------------------------------
// Admin — PATCH /api/v1/admin/plans/:id
// ---------------------------------------------------------------------------

const update = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const plan = await planService.update(id, req.body, req.traceId);
  sendSuccess(res, HTTP.OK, plan, 'Plan updated');
});

// ---------------------------------------------------------------------------
// Admin — PATCH /api/v1/admin/plans/:id/status
// ---------------------------------------------------------------------------

const setStatus = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const plan = await planService.setStatus(id, req.body.status, req.traceId);
  sendSuccess(res, HTTP.OK, plan, 'Plan status updated');
});

// ---------------------------------------------------------------------------
// Admin — DELETE /api/v1/admin/plans/:id
// ---------------------------------------------------------------------------

const remove = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  await planService.softDelete(id, req.traceId);
  sendSuccess(res, HTTP.OK, { id }, 'Plan deleted');
});

// ---------------------------------------------------------------------------
// Admin — PUT /api/v1/admin/plans/:planId/pricing/:durationMonths
// ---------------------------------------------------------------------------

const upsertPricing = asyncHandler(async (req, res) => {
  const planId = parseInt(req.params.planId, 10);
  // parseFloat (not parseInt) so fractional durations like 1.5 survive.
  const durationMonths = parseFloat(req.params.durationMonths);
  const pricing = await planService.upsertPricing(planId, durationMonths, req.body, req.traceId);
  sendSuccess(res, HTTP.OK, pricing, 'Pricing upserted');
});

// ---------------------------------------------------------------------------
// Admin — DELETE /api/v1/admin/plans/:planId/pricing/:pricingId
// ---------------------------------------------------------------------------

const deactivatePricing = asyncHandler(async (req, res) => {
  const planId = parseInt(req.params.planId, 10);
  const pricingId = parseInt(req.params.pricingId, 10);
  const pricing = await planService.deactivatePricing(planId, pricingId, req.traceId);
  sendSuccess(res, HTTP.OK, pricing, 'Pricing deactivated');
});

// ---------------------------------------------------------------------------
// Admin — GET /api/v1/admin/plans/:id/enrollments
// ---------------------------------------------------------------------------

const listEnrollments = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { rows, meta } = await planService.enrolledUsersForPlan(id, req.query, req.traceId);
  sendSuccess(res, HTTP.OK, rows, undefined, meta);
});

module.exports = {
  listPublic,
  getPublicById,
  selectPlan,
  listAdmin,
  getAdminById,
  create,
  update,
  setStatus,
  remove,
  upsertPricing,
  deactivatePricing,
  listEnrollments,
};
