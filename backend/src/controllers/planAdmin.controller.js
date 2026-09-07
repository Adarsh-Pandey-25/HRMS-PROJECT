const planService = require('../services/plan.service');
const { successResponse } = require('../utils/helpers');

const list = async (req, res, next) => {
  try {
    const includeInactive = String(req.query.include_inactive || '') === 'true';
    const plans = await planService.listPlans({ includeInactive });
    successResponse(res, 'Plans fetched', plans);
  } catch (err) { next(err); }
};

const getOne = async (req, res, next) => {
  try {
    const plan = await planService.getPlan(req.params.id);
    successResponse(res, 'Plan fetched', plan);
  } catch (err) { next(err); }
};

const create = async (req, res, next) => {
  try {
    const plan = await planService.createPlan(req.body);
    successResponse(res, 'Plan created', plan, null, 201);
  } catch (err) { next(err); }
};

const update = async (req, res, next) => {
  try {
    const plan = await planService.updatePlan(req.params.id, req.body);
    successResponse(res, 'Plan updated', plan);
  } catch (err) { next(err); }
};

const deactivate = async (req, res, next) => {
  try {
    const plan = await planService.deactivatePlan(req.params.id);
    successResponse(res, 'Plan deactivated', plan);
  } catch (err) { next(err); }
};

module.exports = { list, getOne, create, update, deactivate };
