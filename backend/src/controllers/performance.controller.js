const performanceService = require('../services/performance.service');
const { successResponse } = require('../utils/helpers');
const { getCompanyId } = require('../utils/tenant');

const companyIdOf = (req) => req.user.company_id || getCompanyId(req.user);

const myGoals = async (req, res, next) => {
  try {
    const data = await performanceService.myGoals(req.user.id);
    successResponse(res, 'Goals fetched', data);
  } catch (err) { next(err); }
};

const cycles = async (req, res, next) => {
  try {
    const data = await performanceService.listCycles(companyIdOf(req));
    successResponse(res, 'Review cycles fetched', data);
  } catch (err) { next(err); }
};

const createCycle = async (req, res, next) => {
  try {
    const data = await performanceService.createCycle(req.body, companyIdOf(req));
    successResponse(res, 'Review cycle created', data, null, 201);
  } catch (err) { next(err); }
};

const teamReviews = async (req, res, next) => {
  try {
    const data = await performanceService.teamReviewsForManager(req.user.id);
    successResponse(res, 'Team reviews fetched', data);
  } catch (err) { next(err); }
};

const openTeamReviews = async (req, res, next) => {
  try {
    const data = await performanceService.openTeamReviews(
      req.user.id,
      req.body.cycle_id || req.body.cycleId,
      companyIdOf(req)
    );
    successResponse(res, 'Team reviews opened', data);
  } catch (err) { next(err); }
};

const updateReview = async (req, res, next) => {
  try {
    const data = await performanceService.updateReview(req.params.id, req.user.id, req.body);
    successResponse(res, 'Review updated', data);
  } catch (err) { next(err); }
};

const createGoal = async (req, res, next) => {
  try {
    const data = await performanceService.createGoal(req.user.id, req.body);
    successResponse(res, 'Goal created', data, null, 201);
  } catch (err) { next(err); }
};

const updateGoal = async (req, res, next) => {
  try {
    const isPrivileged = ['hr', 'admin'].includes(req.user.role);
    const data = await performanceService.updateGoal(req.params.id, req.user.id, req.body, isPrivileged);
    successResponse(res, 'Goal updated', data);
  } catch (err) { next(err); }
};

module.exports = {
  myGoals, cycles, createCycle, teamReviews, openTeamReviews, updateReview, createGoal, updateGoal,
};
