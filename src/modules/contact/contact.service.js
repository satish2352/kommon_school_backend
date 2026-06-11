'use strict';

const crypto = require('crypto');
const repo = require('./contact.repository');
const ApiError = require('../../utils/ApiError');
const logger = require('../../config/logger');
const { buildMeta } = require('../../utils/pagination');
const { ENROLLMENT_CODE_PREFIX } = require('../../config/constants');
const { getPrismaClient } = require('../../config/database');
const followupService = require('../followups/followup.service');

function generateEnrollmentCode() {
  const now = new Date();
  const yy = String(now.getUTCFullYear()).slice(-2);
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const hex = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `${ENROLLMENT_CODE_PREFIX}-${yy}${mm}-${hex}`;
}

function splitName(fullName) {
  const t = (fullName || '').trim();
  const i = t.lastIndexOf(' ');
  if (i === -1) return { first_name: t, last_name: '' };
  return { first_name: t.slice(0, i), last_name: t.slice(i + 1) };
}

/**
 * Store a public contact submission AND route it into the Follow-ups pipeline:
 * a lightweight lead enrollment is created with an open followup carrying the
 * message as its reason (shown as the "Description" column). The Follow-ups
 * "Type" column resolves to "website" because a contact_submission exists for
 * the lead's email. Routing is fail-soft — a routing error never blocks the
 * submission being saved.
 */
async function createSubmission({ name, email, phone, message, ipAddress, userAgent }, traceId) {
  const submission = await repo.createSubmission({
    name:      name.trim(),
    email:     email.trim().toLowerCase(),
    phone:     phone ? phone.trim() : null,
    message:   message.trim(),
    ipAddress: ipAddress || null,
    userAgent: userAgent ? String(userAgent).slice(0, 512) : null,
  });

  try {
    const db = getPrismaClient();
    const { first_name, last_name } = splitName(name);
    const enrollment = await db.enrollment.create({
      data: {
        name:            name.trim(),
        first_name,
        last_name,
        email:           email.trim().toLowerCase(),
        phone_number:    phone ? phone.trim() : null,
        enrollment_code: generateEnrollmentCode(),
        status:          'submitted',
        candidate_type:  'EXTERNAL',
      },
    });
    await followupService.autoCreateFromDeadLetter({
      enrollmentId: enrollment.id,
      status:       'new',
      reason:       message.trim(),
      traceId,
    });
  } catch (err) {
    logger.warn({
      msg: 'contact_followup_route_failed',
      traceId,
      submission_id: submission.id,
      error: err?.message || String(err),
    });
  }

  logger.info({ msg: 'contact_submission_created', traceId, id: submission.id, email: submission.email });
  return submission;
}

async function listSubmissions(query, traceId) {
  const page  = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 10));
  const skip  = (page - 1) * limit;

  const { rows, total } = await repo.listSubmissions({
    skip, take: limit, search: query.search, status: query.status,
  });

  logger.info({ msg: 'contact_submissions_listed', traceId, total, page, limit });
  return { rows, meta: buildMeta(page, limit, total) };
}

async function updateStatus(id, status, traceId) {
  const rec = await repo.updateStatus(id, status);
  if (!rec) throw ApiError.notFound('Contact submission not found');
  logger.info({ msg: 'contact_submission_status_updated', traceId, id, status });
  return rec;
}

module.exports = {
  createSubmission,
  listSubmissions,
  updateStatus,
  findLatestMessagesByEmails: repo.findLatestMessagesByEmails,
};
