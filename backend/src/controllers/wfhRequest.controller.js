const wfhRequestService = require('../services/wfhRequest.service');
const { successResponse } = require('../utils/helpers');

const request = async (req, res, next) => {
  try {
    const data = await wfhRequestService.requestWfh(req.user.id, req.body);
    successResponse(res, 'WFH request submitted', data, null, 201);
  } catch (err) { next(err); }
};

const cancel = async (req, res, next) => {
  try {
    const data = await wfhRequestService.cancelRequest(req.user.id, req.params.id);
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
    successResponse(res, `WFH request ${req.body.status}`, data);
  } catch (err) { next(err); }
};

module.exports = { request, cancel, myRequests, pending, review };
