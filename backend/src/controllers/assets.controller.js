const assetsService = require('../services/assets.service');
const { successResponse } = require('../utils/helpers');
const { getCompanyId } = require('../utils/tenant');

const companyIdOf = (req) => req.user.company_id || getCompanyId(req.user);

const companyIds = async (req) => {
  const tenantService = require('../services/tenant.service');
  return tenantService.getCompanyEmployeeIds(companyIdOf(req));
};

const list = async (req, res, next) => {
  try {
    const ids = await companyIds(req);
    const data = await assetsService.listAssets(req.query, ids, companyIdOf(req));
    successResponse(res, 'Assets fetched', data);
  } catch (err) { next(err); }
};

const mine = async (req, res, next) => {
  try {
    const data = await assetsService.myAssets(req.user.id, companyIdOf(req));
    successResponse(res, 'My assets fetched', data);
  } catch (err) { next(err); }
};

const requests = async (req, res, next) => {
  try {
    const ids = await companyIds(req);
    const data = await assetsService.listRequests(req.query, ids, companyIdOf(req));
    successResponse(res, 'Asset requests fetched', data);
  } catch (err) { next(err); }
};

const submitRequest = async (req, res, next) => {
  try {
    const data = await assetsService.createRequest(req.user.id, req.body, companyIdOf(req));
    successResponse(res, 'Asset request submitted', data, null, 201);
  } catch (err) { next(err); }
};

const actOnRequest = async (req, res, next) => {
  try {
    const ids = await companyIds(req);
    const data = await assetsService.updateRequestStatus(
      req.params.id,
      req.body.status,
      ids,
      companyIdOf(req),
    );
    successResponse(res, 'Request updated', data);
  } catch (err) { next(err); }
};

const create = async (req, res, next) => {
  try {
    const data = await assetsService.createAsset(req.body, companyIdOf(req));
    successResponse(res, 'Asset created', data, null, 201);
  } catch (err) { next(err); }
};

const update = async (req, res, next) => {
  try {
    const ids = await companyIds(req);
    const data = await assetsService.updateAsset(req.params.id, req.body, companyIdOf(req), ids);
    successResponse(res, 'Asset updated', data);
  } catch (err) { next(err); }
};

const assign = async (req, res, next) => {
  try {
    const ids = await companyIds(req);
    const employeeId = req.body.employee_id || req.body.employeeId;
    const data = await assetsService.assignAsset(req.params.id, employeeId, companyIdOf(req), ids);
    successResponse(res, 'Asset assigned', data);
  } catch (err) { next(err); }
};

const returnAsset = async (req, res, next) => {
  try {
    const data = await assetsService.returnAsset(req.params.id, companyIdOf(req));
    successResponse(res, 'Asset returned to inventory', data);
  } catch (err) { next(err); }
};

const categories = async (req, res, next) => {
  try {
    const data = await assetsService.listCategories(companyIdOf(req));
    successResponse(res, 'Asset categories fetched', data);
  } catch (err) { next(err); }
};

const createCategory = async (req, res, next) => {
  try {
    const data = await assetsService.createCategory(req.body, companyIdOf(req));
    successResponse(res, 'Category created', data, null, 201);
  } catch (err) { next(err); }
};

module.exports = {
  list,
  mine,
  requests,
  submitRequest,
  actOnRequest,
  create,
  update,
  assign,
  returnAsset,
  categories,
  createCategory,
};
