'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const { sendSuccess } = require('../../utils/ApiResponse');
const { HTTP } = require('../../config/constants');
const service = require('./reports.service');

/**
 * GET /api/v1/reports/payments-summary
 */
const paymentsSummary = asyncHandler(async (req, res) => {
  const { dateFrom, dateTo } = req.query;
  const data = await service.getPaymentsSummary({ dateFrom, dateTo }, req.traceId);
  return sendSuccess(res, HTTP.OK, data, 'Payments summary');
});

/**
 * GET /api/v1/reports/enrollments-funnel
 */
const enrollmentsFunnel = asyncHandler(async (req, res) => {
  const { dateFrom, dateTo } = req.query;
  const data = await service.getEnrollmentsFunnel({ dateFrom, dateTo }, req.traceId);
  return sendSuccess(res, HTTP.OK, data, 'Enrollments funnel');
});

/**
 * GET /api/v1/reports/external-api-health
 */
const externalApiHealth = asyncHandler(async (req, res) => {
  const { dateFrom, dateTo } = req.query;
  const data = await service.getExternalApiHealth({ dateFrom, dateTo }, req.traceId);
  return sendSuccess(res, HTTP.OK, data, 'External API health');
});

/**
 * GET /api/v1/reports/export
 * The service streams CSV directly to res — sendSuccess is NOT used here.
 */
const exportCsv = asyncHandler(async (req, res) => {
  const { type, dateFrom, dateTo } = req.query;
  await service.streamCsv({ type, dateFrom, dateTo, res, traceId: req.traceId });
});

module.exports = { paymentsSummary, enrollmentsFunnel, externalApiHealth, exportCsv };
