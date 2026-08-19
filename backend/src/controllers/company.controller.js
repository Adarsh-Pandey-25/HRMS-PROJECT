const companyService = require('../services/company.service');
const { successResponse } = require('../utils/helpers');
const { getCompanyId } = require('../utils/tenant');

const companyIdOf = (req) => req.user.company_id || getCompanyId(req.user);

const getMe = async (req, res, next) => {
  try {
    const data = await companyService.getMyCompany(companyIdOf(req));
    successResponse(res, 'Company fetched', data);
  } catch (err) { next(err); }
};

const listAccessible = async (req, res, next) => {
  try {
    const data = await companyService.listAccessibleCompanies(companyIdOf(req));
    successResponse(res, 'Accessible companies fetched', data);
  } catch (err) { next(err); }
};

const listChildren = async (req, res, next) => {
  try {
    const data = await companyService.listChildren(companyIdOf(req));
    successResponse(res, 'Child companies fetched', data);
  } catch (err) { next(err); }
};

const createChild = async (req, res, next) => {
  try {
    const data = await companyService.createChild(
      companyIdOf(req),
      req.user.id,
      {
        name: req.body.name,
        slug: req.body.slug,
      },
    );
    successResponse(res, 'Child company created', data, null, 201);
  } catch (err) { next(err); }
};

const updateChild = async (req, res, next) => {
  try {
    const data = await companyService.updateChild(
      companyIdOf(req),
      req.params.id,
      {
        name: req.body.name,
        is_active: req.body.is_active ?? req.body.isActive,
      },
    );
    successResponse(res, 'Child company updated', data);
  } catch (err) { next(err); }
};

const listEmployees = async (req, res, next) => {
  try {
    const data = await companyService.listCompanyEmployees(
      companyIdOf(req),
      req.params.id,
    );
    successResponse(res, 'Company employees fetched', data);
  } catch (err) { next(err); }
};

const uploadLogo = async (req, res, next) => {
  try {
    const data = await companyService.uploadOrgCompanyLogo(
      companyIdOf(req),
      req.params.id,
      req.file,
      req.user.id,
    );
    successResponse(res, 'Company logo uploaded', data);
  } catch (err) { next(err); }
};

const getDetails = async (req, res, next) => {
  try {
    const data = await companyService.getCompanyDetails(companyIdOf(req), req.params.id);
    successResponse(res, 'Company details fetched', data);
  } catch (err) { next(err); }
};

const updateDetails = async (req, res, next) => {
  try {
    const data = await companyService.updateCompanyDetails(
      companyIdOf(req),
      req.params.id,
      req.body || {},
      req.user.id,
    );
    successResponse(res, 'Company details updated', data);
  } catch (err) { next(err); }
};

module.exports = {
  getMe,
  listAccessible,
  listChildren,
  createChild,
  updateChild,
  listEmployees,
  uploadLogo,
  getDetails,
  updateDetails,
};
