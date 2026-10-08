const assetsService = require('../services/assets.service');
const { auditFromRequest } = require('../services/auditLog.service');
const { successResponse } = require('../utils/helpers');
const { getCompanyId } = require('../utils/tenant');

const companyIdOf = (req) => req.user.company_id || getCompanyId(req.user);

const companyIds = async (req) => {
  const tenantService = require('../services/tenant.service');
  const home = companyIdOf(req);
  if (['admin', 'hr'].includes(req.user.role)) {
    return tenantService.getOrgEmployeeIds(home);
  }
  return tenantService.getCompanyEmployeeIds(home);
};

const list = async (req, res, next) => {
  try {
    const ids = await companyIds(req);
    const result = await assetsService.listAssets(req.query, ids, companyIdOf(req), req.query);
    successResponse(res, 'Assets fetched', result.data, result.meta);
  } catch (err) { next(err); }
};

const mine = async (req, res, next) => {
  try {
    const result = await assetsService.myAssets(req.user.id, companyIdOf(req), req.query);
    successResponse(res, 'My assets fetched', result.data, result.meta);
  } catch (err) { next(err); }
};

const requests = async (req, res, next) => {
  try {
    const isPrivileged = ['admin', 'hr'].includes(req.user.role);
    // Employees only see their own requests; HR/Admin see the company queue.
    const ids = isPrivileged ? await companyIds(req) : [req.user.id];
    const result = await assetsService.listRequests(req.query, ids, companyIdOf(req), req.query);
    successResponse(res, 'Asset requests fetched', result.data, result.meta);
  } catch (err) { next(err); }
};

const submitRequest = async (req, res, next) => {
  try {
    const data = await assetsService.createRequest(req.user.id, req.body, companyIdOf(req));
    auditFromRequest(req, {
      actionType: 'asset.request.submit', targetType: 'asset_request', targetId: data.id,
      afterState: { assetType: data.asset_type, urgency: data.urgency, status: data.status },
    });
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
    auditFromRequest(req, {
      actionType: `asset.request.${String(req.body.status || '').toLowerCase()}`,
      targetType: 'asset_request', targetId: req.params.id,
      afterState: { status: data.status, assetType: data.asset_type, employeeId: data.employee_id },
    });
    successResponse(res, 'Request updated', data);
  } catch (err) { next(err); }
};

const create = async (req, res, next) => {
  try {
    const data = await assetsService.createAsset(req.body, companyIdOf(req));
    auditFromRequest(req, {
      actionType: 'asset.create', targetType: 'asset', targetId: data.id,
      afterState: { name: data.name, category: data.category, serialNumber: data.serial_number },
    });
    successResponse(res, 'Asset created', data, null, 201);
  } catch (err) { next(err); }
};

const update = async (req, res, next) => {
  try {
    const ids = await companyIds(req);
    const data = await assetsService.updateAsset(req.params.id, req.body, companyIdOf(req), ids);
    auditFromRequest(req, {
      actionType: 'asset.update', targetType: 'asset', targetId: req.params.id,
      afterState: { name: data.name, category: data.category, status: data.status, location: data.location },
    });
    successResponse(res, 'Asset updated', data);
  } catch (err) { next(err); }
};

const assign = async (req, res, next) => {
  try {
    const ids = await companyIds(req);
    const employeeId = req.body.employee_id || req.body.employeeId;
    const data = await assetsService.assignAsset(req.params.id, employeeId, companyIdOf(req), ids);
    require('../services/webhook.service').dispatchWebhookEvent(companyIdOf(req), 'asset.assigned', {
      assetId: req.params.id, employeeId,
    });
    auditFromRequest(req, {
      actionType: 'asset.assign', targetType: 'asset', targetId: req.params.id,
      afterState: { name: data.name, assignedTo: employeeId, assignedOn: data.assigned_on },
    });
    successResponse(res, 'Asset assigned', data);
  } catch (err) { next(err); }
};

const returnAsset = async (req, res, next) => {
  try {
    const data = await assetsService.returnAsset(req.params.id, companyIdOf(req));
    auditFromRequest(req, {
      actionType: 'asset.return', targetType: 'asset', targetId: req.params.id,
      afterState: { name: data.name, status: data.status },
    });
    successResponse(res, 'Asset returned to inventory', data);
  } catch (err) { next(err); }
};

/** Employee asks to hand an asset back — HR/Admin approve it from Helpdesk. */
const requestReturn = async (req, res, next) => {
  try {
    const { ticket, asset } = await assetsService.requestAssetReturn(
      req.params.id, req.user.id, companyIdOf(req), req.body.reason,
    );
    auditFromRequest(req, {
      actionType: 'asset.return.request', targetType: 'asset', targetId: req.params.id,
      afterState: { name: asset?.name, ticketId: ticket?.id },
    });
    successResponse(res, 'Return request sent for approval', ticket, null, 201);
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
    auditFromRequest(req, {
      actionType: 'asset.category.create', targetType: 'asset_category', targetId: data?.id,
      afterState: { name: data?.name },
    });
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
  requestReturn,
  categories,
  createCategory,
};
