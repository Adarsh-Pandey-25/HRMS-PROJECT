const salaryRevisionService = require('../services/salaryRevision.service');
const { successResponse } = require('../utils/helpers');
const { getCompanyId } = require('../utils/tenant');
const { getOrgCompanyIds } = require('../services/tenant.service');

/** HR/Admin manage every company in their organization, same as employee records. */
const scopeFor = (req) => getOrgCompanyIds(req.user.company_id || getCompanyId(req.user));

const list = async (req, res, next) => {
  try {
    const data = await salaryRevisionService.listRevisions({
      scopeIds: await scopeFor(req),
      employeeId: req.query.employee_id || req.query.employeeId,
      status: req.query.status,
      limit: req.query.limit,
    });
    successResponse(res, 'Salary revisions fetched', data);
  } catch (err) { next(err); }
};

const create = async (req, res, next) => {
  try {
    const { employee_id: employeeId, components, effective_date: effectiveDate, reason } = req.body;
    const revision = await salaryRevisionService.createRevision({
      scopeIds: await scopeFor(req),
      actor: req.user,
      ipAddress: req.ip,
      employeeId,
      components,
      effectiveDate,
      reason,
    });
    const message = revision?.status === 'applied'
      ? 'Salary revised and applied'
      : `Salary revision scheduled for ${revision?.effective_date}`;
    successResponse(res, message, revision, null, 201);
  } catch (err) { next(err); }
};

const cancel = async (req, res, next) => {
  try {
    const revision = await salaryRevisionService.cancelRevision({
      scopeIds: await scopeFor(req),
      actor: req.user,
      ipAddress: req.ip,
      id: req.params.id,
    });
    successResponse(res, 'Salary revision cancelled', revision);
  } catch (err) { next(err); }
};

module.exports = { list, create, cancel };
