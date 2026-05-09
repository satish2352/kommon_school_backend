'use strict';

const dashboardService = require('./dashboard.service');
const { sendSuccess } = require('../../../utils/ApiResponse');
const asyncHandler = require('../../../utils/asyncHandler');
const { HTTP } = require('../../../config/constants');

/**
 * GET /api/v1/admin/dashboard
 * Returns today's counters and pending-action counts for the admin dashboard.
 */
const getSummary = asyncHandler(async (req, res) => {
  const data = await dashboardService.getDashboardSummary();
  sendSuccess(res, HTTP.OK, data);
});

module.exports = { getSummary };
