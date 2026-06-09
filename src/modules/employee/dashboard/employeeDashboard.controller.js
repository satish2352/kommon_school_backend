'use strict';

const service = require('./employeeDashboard.service');
const asyncHandler = require('../../../utils/asyncHandler');
const { sendSuccess } = require('../../../utils/ApiResponse');
const { HTTP } = require('../../../config/constants');

// GET /api/v1/employee/dashboard
const getDashboard = asyncHandler(async (req, res) => {
  const data = await service.getDashboard(req.user.id, req.traceId);
  sendSuccess(res, HTTP.OK, data);
});

module.exports = { getDashboard };
