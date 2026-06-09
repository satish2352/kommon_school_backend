'use strict';

const service = require('./employeeLead.service');
const asyncHandler = require('../../../utils/asyncHandler');
const { sendSuccess } = require('../../../utils/ApiResponse');
const { HTTP } = require('../../../config/constants');

// GET /api/v1/employee/leads
const list = asyncHandler(async (req, res) => {
  const { items, meta } = await service.listMyLeads(req.query, req.user.id, req.traceId);
  sendSuccess(res, HTTP.OK, { items, ...meta });
});

// GET /api/v1/employee/leads/:enrollmentId
const detail = asyncHandler(async (req, res) => {
  const data = await service.getLeadDetail(req.params.enrollmentId, req.user, req.traceId);
  sendSuccess(res, HTTP.OK, data);
});

// POST /api/v1/employee/leads/:enrollmentId/notes
const addNote = asyncHandler(async (req, res) => {
  const data = await service.addNote({
    enrollmentId:   req.params.enrollmentId,
    body:           req.body.body,
    metadata:       req.body.metadata,
    requestingUser: req.user,
    traceId:        req.traceId,
  });
  sendSuccess(res, HTTP.CREATED, data, 'Note added');
});

// PATCH /api/v1/employee/leads/:enrollmentId/status
const updateStatus = asyncHandler(async (req, res) => {
  const data = await service.updateStatusAndSchedule({
    enrollmentId:     req.params.enrollmentId,
    status:           req.body.status,
    nextFollowupDate: req.body.nextFollowupDate,
    requestingUser:   req.user,
    traceId:          req.traceId,
    req,
  });
  sendSuccess(res, HTTP.OK, data, 'Lead updated');
});

module.exports = { list, detail, addNote, updateStatus };
