'use strict';

const {
  createManualEnrollment,
  createInternalEnrollment,
  createBulkEnrollments,
} = require('./adminEnrollment.service');
const { sendSuccess } = require('../../utils/ApiResponse');
const asyncHandler = require('../../utils/asyncHandler');
const { HTTP } = require('../../config/constants');

// ---------------------------------------------------------------------------
// CSV template column definitions
//
// Only the student-identity fields live in the CSV — the Course + Internal Plan
// (and therefore plan / unit / pricing) are chosen once in the upload UI and
// applied to every row. So the template is just name, email, phone.
// ---------------------------------------------------------------------------
const CSV_HEADER = 'name,email,phone';
const CSV_EXAMPLE =
  'Sumago Dev,sumagodev1@gmail.com,9876543210\n' +
  'Jane Doe,jane@example.com,9123456780';

/**
 * POST /api/v1/admin/enrollments/manual
 * Create a single enrollment manually (no Razorpay).
 */
const createManual = asyncHandler(async (req, res) => {
  const result = await createManualEnrollment({
    data: req.body,
    actor: req.user,
    adminSource: 'MANUAL',
    traceId: req.traceId,
  });

  sendSuccess(res, HTTP.CREATED, result, 'Enrollment created successfully');
});

/**
 * POST /api/v1/admin/enrollments/internal
 *
 * Admin "New Enrollment" wizard, internal-flow endpoint. Carries
 * { name, email, phone, role, education?, readiness?, source?,
 *   courseId, internalPlanId, internalCouponCode?, notes? }.
 *
 * Backend recomputes pricing from internalPlanId + courseId + couponCode;
 * fee values in the body are silently dropped by the validator.
 */
const createInternal = asyncHandler(async (req, res) => {
  const result = await createInternalEnrollment({
    data:        req.body,
    actor:       req.user,
    adminSource: 'INTERNAL',
    traceId:     req.traceId,
    req,
  });
  sendSuccess(res, HTTP.CREATED, result, 'Enrollment created successfully');
});

/**
 * POST /api/v1/admin/enrollments/bulk
 * Bulk-create enrollments from a CSV file (multipart/form-data).
 */
const createBulk = asyncHandler(async (req, res) => {
  const ApiError = require('../../utils/ApiError');
  if (!req.file) {
    throw ApiError.badRequest('No CSV file uploaded. Use field name "file".');
  }

  // The plan context (Course + Internal Plan picked in the UI) rides along as a
  // JSON string field; every CSV row is enrolled into this plan.
  let planContext = {};
  if (req.body?.planContext) {
    try {
      planContext = JSON.parse(req.body.planContext);
    } catch {
      throw ApiError.badRequest('Invalid planContext — could not parse the selected plan.');
    }
  }

  const result = await createBulkEnrollments({
    fileBuffer:         req.file.buffer,
    actor:              req.user,
    traceId:            req.traceId,
    req,
    courseId:           planContext.courseId,
    internalPlanId:     planContext.internalPlanId,
    internalCouponCode: planContext.internalCouponCode || planContext.couponCode || null,
  });

  sendSuccess(res, HTTP.CREATED, result, 'Bulk enrollment processing complete');
});

/**
 * GET /api/v1/admin/enrollments/csv-template
 * Download a CSV template with header row + one example row.
 */
const getCsvTemplate = asyncHandler(async (req, res) => {
  const csv = `${CSV_HEADER}\n${CSV_EXAMPLE}\n`;

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="enrollment-template.csv"');
  res.status(HTTP.OK).send(csv);
});

module.exports = { createManual, createInternal, createBulk, getCsvTemplate };
