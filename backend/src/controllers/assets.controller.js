const assetsService = require('../services/assets.service');
const { successResponse } = require('../utils/helpers');

const companyIds = async (req) => {
  const tenantService = require('../services/tenant.service');
  const { getCompanyId } = require('../utils/tenant');
  return tenantService.getCompanyEmployeeIds(req.user.company_id || getCompanyId(req.user));
};

const list = async (req, res, next) => {
  try {
    const ids = await companyIds(req);
    const data = await assetsService.listAssets(req.query, ids);
    successResponse(res, 'Assets fetched', data);
  } catch (err) { next(err); }
};

const mine = async (req, res, next) => {
  try {
    const data = await assetsService.myAssets(req.user.id);
    successResponse(res, 'My assets fetched', data);
  } catch (err) { next(err); }
};

const requests = async (req, res, next) => {
  try {
    const ids = await companyIds(req);
    const data = await assetsService.listRequests(req.query, ids);
    successResponse(res, 'Asset requests fetched', data);
  } catch (err) { next(err); }
};

const submitRequest = async (req, res, next) => {
  try {
    const data = await assetsService.createRequest(req.user.id, req.body);
    successResponse(res, 'Asset request submitted', data, null, 201);
  } catch (err) { next(err); }
};

const actOnRequest = async (req, res, next) => {
  try {
    const ids = await companyIds(req);
    const data = await assetsService.updateRequestStatus(req.params.id, req.body.status, ids);
    if (!data) return res.status(404).json({ success: false, error: { message: 'Request not found' } });
    successResponse(res, 'Request updated', data);
  } catch (err) { next(err); }
};

const create = async (req, res, next) => {
  try {
    const data = await assetsService.createAsset(req.body);
    successResponse(res, 'Asset created', data, null, 201);
  } catch (err) { next(err); }
};

const categories = async (req, res, next) => {
  try {
    const data = await assetsService.listCategories();
    successResponse(res, 'Asset categories fetched', data);
  } catch (err) { next(err); }
};

module.exports = { list, mine, requests, submitRequest, actOnRequest, create, categories };
