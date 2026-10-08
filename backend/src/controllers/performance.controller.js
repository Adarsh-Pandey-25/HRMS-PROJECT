const performanceService = require('../services/performance.service');
const { successResponse } = require('../utils/helpers');
const { auditFromRequest } = require('../services/auditLog.service');
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
        auditFromRequest(req, {
      actionType: 'performance.cycle.create', targetType: 'review_cycle', targetId: data?.id,
      afterState: { name: data?.name, status: data?.status },
    });
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
        auditFromRequest(req, {
      actionType: 'performance.reviews.open', targetType: 'review_cycle',
      targetId: req.body.cycle_id || req.body.cycleId,
      afterState: { opened: Array.isArray(data) ? data.length : undefined },
    });
    successResponse(res, 'Team reviews opened', data);
  } catch (err) { next(err); }
};

const updateReview = async (req, res, next) => {
  try {
    const data = await performanceService.updateReview(req.params.id, req.user.id, req.body, companyIdOf(req));
        auditFromRequest(req, {
      actionType: 'performance.review.update', targetType: 'performance_review', targetId: req.params.id,
      afterState: { status: data?.status, rating: data?.rating },
    });
    successResponse(res, 'Review updated', data);
  } catch (err) { next(err); }
};

const createGoal = async (req, res, next) => {
  try {
    const data = await performanceService.createGoal(req.user.id, req.body, companyIdOf(req));
        auditFromRequest(req, {
      actionType: 'performance.goal.create', targetType: 'goal', targetId: data?.id,
      afterState: { title: data?.title, status: data?.status },
    });
    successResponse(res, 'Goal created', data, null, 201);
  } catch (err) { next(err); }
};

const updateGoal = async (req, res, next) => {
  try {
    const isPrivileged = ['hr', 'admin'].includes(req.user.role);
    const data = await performanceService.updateGoal(req.params.id, req.user.id, req.body, isPrivileged, companyIdOf(req));
        auditFromRequest(req, {
      actionType: 'performance.goal.update', targetType: 'goal', targetId: req.params.id,
      afterState: { title: data?.title, status: data?.status, progress: data?.progress },
    });
    successResponse(res, 'Goal updated', data);
  } catch (err) { next(err); }
};

module.exports = {
  myGoals, cycles, createCycle, teamReviews, openTeamReviews, updateReview, createGoal, updateGoal,
};
