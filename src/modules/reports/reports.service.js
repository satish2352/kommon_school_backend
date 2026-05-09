'use strict';

const { stringify } = require('csv-stringify');
const logger = require('../../config/logger');
const repo = require('./reports.repository');
const ApiError = require('../../utils/ApiError');
const { ERROR_CODES, HTTP } = require('../../config/constants');

/**
 * Payments summary report.
 *
 * @param {{ dateFrom?: Date, dateTo?: Date }} query
 * @param {string} traceId
 * @returns {Promise<object>}
 */
async function getPaymentsSummary(query, traceId) {
  const data = await repo.getPaymentsSummary(query);
  logger.info({
    msg: 'report_payments_summary',
    traceId,
    total_count: data.total_count,
    total_amount_paise: data.total_amount_paise,
  });
  return data;
}

/**
 * Enrollment funnel report.
 *
 * @param {{ dateFrom?: Date, dateTo?: Date }} query
 * @param {string} traceId
 * @returns {Promise<object>}
 */
async function getEnrollmentsFunnel(query, traceId) {
  const data = await repo.getEnrollmentsFunnel(query);
  logger.info({
    msg: 'report_enrollments_funnel',
    traceId,
    stage_count: data.stages.length,
  });
  return data;
}

/**
 * External API health report.
 *
 * @param {{ dateFrom?: Date, dateTo?: Date }} query
 * @param {string} traceId
 * @returns {Promise<object>}
 */
async function getExternalApiHealth(query, traceId) {
  const data = await repo.getExternalApiHealth(query);
  logger.info({
    msg: 'report_external_api_health',
    traceId,
    dead_letter_recent_count: data.dead_letter_recent.length,
  });
  return data;
}

/**
 * Stream a CSV export directly to the Express response object.
 * Supports type='payments' only. Errors before headers are sent propagate to
 * the centralized error handler; errors after headers are sent are logged and
 * the stream is forcibly ended.
 *
 * @param {{ type: string, dateFrom?: Date, dateTo?: Date, res: import('express').Response, traceId: string }} opts
 * @returns {Promise<void>}
 */
async function streamCsv({ type, dateFrom, dateTo, res, traceId }) {
  if (type !== 'payments') {
    throw new ApiError(
      HTTP.BAD_REQUEST,
      ERROR_CODES.UNSUPPORTED_REPORT_TYPE,
      `Report type '${type}' is not supported. Supported types: payments`,
    );
  }

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="payments-export-${today}.csv"`);

  const csvStringifier = stringify({
    header: true,
    columns: [
      { key: 'payment_id',            header: 'payment_id' },
      { key: 'order_id',              header: 'order_id' },
      { key: 'razorpay_payment_id',   header: 'razorpay_payment_id' },
      { key: 'status',                header: 'status' },
      { key: 'amount_paise',          header: 'amount_paise' },
      { key: 'amount_inr',            header: 'amount_inr' },
      { key: 'currency',              header: 'currency' },
      { key: 'created_at',            header: 'created_at' },
      { key: 'enrollment_email',      header: 'enrollment_email' },
      { key: 'enrollment_first_name', header: 'enrollment_first_name' },
      { key: 'enrollment_last_name',  header: 'enrollment_last_name' },
      { key: 'enrollment_phone',      header: 'enrollment_phone' },
      { key: 'plan',                  header: 'plan' },
    ],
  });

  csvStringifier.pipe(res);

  let headersSent = false;
  csvStringifier.on('data', () => {
    // Once csv-stringify starts emitting data, headers are committed by Express
    headersSent = true;
  });

  try {
    for await (const row of repo.streamPaymentsForExport({ dateFrom, dateTo })) {
      csvStringifier.write({
        payment_id:            row.id,
        order_id:              row.razorpay_order_id,
        razorpay_payment_id:   row.razorpay_payment_id || '',
        status:                row.status,
        amount_paise:          row.amount,
        amount_inr:            (row.amount / 100).toFixed(2),
        currency:              row.currency,
        created_at:            row.created_at ? row.created_at.toISOString() : '',
        enrollment_email:      row.enrollment ? row.enrollment.email : '',
        enrollment_first_name: row.enrollment ? row.enrollment.first_name : '',
        enrollment_last_name:  row.enrollment ? row.enrollment.last_name : '',
        enrollment_phone:      row.enrollment ? row.enrollment.phone_number : '',
        plan:                  row.enrollment ? row.enrollment.plan : '',
      });
    }

    await new Promise((resolve, reject) => {
      csvStringifier.end((err) => {
        if (err) return reject(err);
        resolve();
      });
    });

    logger.info({ msg: 'report_csv_export_complete', traceId, type });
  } catch (err) {
    logger.error({ msg: 'report_csv_export_error', traceId, type, error: err.message });

    // Determine whether response headers have already been flushed to the client
    if (res.headersSent || headersSent) {
      // Cannot change status code — just close the socket cleanly
      try {
        csvStringifier.end();
      } catch (_) {
        // swallow secondary error
      }
      res.end();
    } else {
      throw err;
    }
  }
}

module.exports = {
  getPaymentsSummary,
  getEnrollmentsFunnel,
  getExternalApiHealth,
  streamCsv,
};
