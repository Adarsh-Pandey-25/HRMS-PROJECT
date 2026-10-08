const wfhRequestService = require('../services/wfhRequest.service');
const { successResponse } = require('../utils/helpers');
const { auditFromRequest } = require('../services/auditLog.service');

const request = async (req, res, next) => {
  try {
    const data = await wfhRequestService.requestWfh(req.user.id, req.body);
        auditFromRequest(req, {
      actionType: 'wfh.request', targetType: 'wfh_request', targetId: data?.id,
      afterState: { fromDate: data?.from_date, toDate: data?.to_date, totalDays: data?.total_days, status: data?.status },
    });
    successResponse(res, 'WFH request submitted', data, null, 201);
  } catch (err) { next(err); }
};

const cancel = async (req, res, next) => {
  try {
    const data = await wfhRequestService.cancelRequest(req.user.id, req.params.id);
        auditFromRequest(req, {
      actionType: 'wfh.cancel', targetType: 'wfh_request', targetId: req.params.id,
      afterState: { fromDate: data?.from_date, toDate: data?.to_date, status: data?.status },
    });
    successResponse(res, 'WFH request cancelled', data);
  } catch (err) { next(err); }
};

const myRequests = async (req, res, next) => {
  try {
    const result = await wfhRequestService.listMine(req.user.id, req.query);
    successResponse(res, 'WFH requests fetched', result.data, result.meta);
  } catch (err) { next(err); }
};

const pending = async (req, res, next) => {
  try {
    const result = await wfhRequestService.listPendingForReviewer(req.user, req.query);
    successResponse(res, 'Pending WFH requests fetched', result.data, result.meta);
  } catch (err) { next(err); }
};

const review = async (req, res, next) => {
  try {
    const data = await wfhRequestService.review(req.user, req.params.id, req.body);
        auditFromRequest(req, {
      actionType: `wfh.${String(req.body.status || '').toLowerCase()}`,
      targetType: 'wfh_request', targetId: req.params.id,
      afterState: { fromDate: data?.from_date, toDate: data?.to_date, totalDays: data?.total_days,
        status: data?.status, reviewNote: req.body.review_note || undefined },
    });
    successResponse(res, `WFH request ${req.body.status}`, data);
  } catch (err) { next(err); }
};

module.exports = { request, cancel, myRequests, pending, review };
