'use strict';

const configService = require('./razorpayConfig.service');
const { sendSuccess } = require('../../../utils/ApiResponse');
const asyncHandler = require('../../../utils/asyncHandler');
const { HTTP } = require('../../../config/constants');

/**
 * POST /api/v1/admin/razorpay-configs
 */
const create = asyncHandler(async (req, res) => {
  const config = await configService.createConfig({ body: req.body, actor: req.user, req });
  sendSuccess(res, HTTP.CREATED, config, 'Razorpay configuration created');
});

/**
 * GET /api/v1/admin/razorpay-configs
 */
const list = asyncHandler(async (req, res) => {
  const { rows, meta } = await configService.listConfigs(req.query, req.traceId);
  sendSuccess(res, HTTP.OK, rows, undefined, meta);
});

/**
 * GET /api/v1/admin/razorpay-configs/:id
 */
const getById = asyncHandler(async (req, res) => {
  const config = await configService.getConfigById(req.params.id);
  sendSuccess(res, HTTP.OK, config);
});

/**
 * PATCH /api/v1/admin/razorpay-configs/:id/activate
 */
const activate = asyncHandler(async (req, res) => {
  const config = await configService.activateConfig({ id: req.params.id, actor: req.user, req });
  sendSuccess(res, HTTP.OK, config, 'Razorpay configuration activated');
});

/**
 * DELETE /api/v1/admin/razorpay-configs/:id
 */
const remove = asyncHandler(async (req, res) => {
  await configService.deleteConfig({ id: req.params.id, actor: req.user, req });
  sendSuccess(res, HTTP.OK, null, 'Razorpay configuration deleted');
});

module.exports = { create, list, getById, activate, remove };
