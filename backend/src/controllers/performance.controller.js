const performanceService = require('../services/performance.service');
const { successResponse } = require('../utils/helpers');

const myGoals = async (req, res, next) => {
  try {
    const data = await performanceService.myGoals(req.user.id);
    successResponse(res, 'Goals fetched', data);
  } catch (err) { next(err); }
};

const cycles = async (req, res, next) => {
  try {
    const data = await performanceService.listCycles();
    successResponse(res, 'Review cycles fetched', data);
  } catch (err) { next(err); }
};

const teamReviews = async (req, res, next) => {
  try {
    const data = await performanceService.teamReviewsForManager(req.user.id);
    successResponse(res, 'Team reviews fetched', data);
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
    const data = await performanceService.updateGoal(req.params.id, req.body);
    if (!data) return res.status(404).json({ success: false, error: { message: 'Goal not found' } });
    successResponse(res, 'Goal updated', data);
  } catch (err) { next(err); }
};

module.exports = { myGoals, cycles, teamReviews, createGoal, updateGoal };
