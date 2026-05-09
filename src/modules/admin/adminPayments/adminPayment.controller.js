'use strict';

const repo = require('./adminPayment.repository');
const { sendSuccess } = require('../../../utils/ApiResponse');
const asyncHandler = require('../../../utils/asyncHandler');
const { HTTP } = require('../../../config/constants');
const { parsePagination, buildMeta } = require('../../../utils/pagination');
const { mapPaymentStatus, pickEnrollmentSummary } = require('../../../utils/transformAdmin');
const logger = require('../../../config/logger');

/**
 * Map a raw Prisma payment row to the camelCase shape the React frontend expects.
 *
 * @param {object} r — raw payment row (may include enrollment relation)
 * @returns {object}
 */
function toPaymentItem(r) {
  return {
    id:                r.id,
    razorpayOrderId:   r.razorpay_order_id   || null,
    razorpayPaymentId: r.razorpay_payment_id || null,
    amount:            r.amount,
    finalAmount:       r.amount,
    currency:          r.currency || 'INR',
    status:            mapPaymentStatus(r.status),
    createdAt:         r.created_at,
    updatedAt:         r.updated_at,
    enrollment:        pickEnrollmentSummary(r.enrollment),
  };
}

/**
 * GET /api/v1/admin/payments
 * All payments, paginated. Supports optional status / dateFrom / dateTo filters.
 */
const list = asyncHandler(async (req, res) => {
  const { page, limit, skip, sortBy, sortOrder, dateFrom, dateTo } = parsePagination(req.query);

  const where = {};
  if (req.query.status) {
    where.status = req.query.status;
  }
  if (dateFrom || dateTo) {
    where.created_at = {};
    if (dateFrom) where.created_at.gte = dateFrom;
    if (dateTo)   where.created_at.lte = dateTo;
  }

  const { rows, total } = await repo.listPayments({
    skip,
    take:    limit,
    where,
    orderBy: { [sortBy]: sortOrder },
  });

  logger.info({ msg: 'admin_payments_listed', total, page, limit });

  sendSuccess(res, HTTP.OK, {
    items:      rows.map(toPaymentItem),
    total,
    page,
    limit,
    totalPages: buildMeta(page, limit, total).totalPages,
  });
});

/**
 * GET /api/v1/admin/payments/failed
 * Failed/expired/cancelled payments only.
 */
const listFailed = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);

  const where = {
    status: { in: ['failed', 'expired', 'cancelled'] },
  };

  const { rows, total } = await repo.listPayments({
    skip,
    take:    limit,
    where,
    orderBy: { created_at: 'desc' },
  });

  logger.info({ msg: 'admin_failed_payments_listed', total, page, limit });

  sendSuccess(res, HTTP.OK, {
    items:      rows.map(toPaymentItem),
    total,
    page,
    limit,
    totalPages: buildMeta(page, limit, total).totalPages,
  });
});

module.exports = { list, listFailed };
