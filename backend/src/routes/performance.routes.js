const express = require('express');
const performanceController = require('../controllers/performance.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { isManagerOrAbove, isHROrAdmin } = require('../middleware/role.middleware');
const { requirePermission } = require('../middleware/requirePermission');

const router = express.Router();

router.use(authenticate);

// Settings → User & Role Management → Performance Reviews: Approve = Team
// Reviews, Manage = review cycles. A person's own goals never need it.
const can = (action) => requirePermission('performance', action);

router.get('/goals', performanceController.myGoals);
router.post('/goals', performanceController.createGoal);
router.put('/goals/:id', performanceController.updateGoal);
router.get('/cycles', performanceController.cycles);
router.post('/cycles', isHROrAdmin, can('manage'), performanceController.createCycle);
router.get('/team-reviews', isManagerOrAbove, can('approve'), performanceController.teamReviews);
router.post('/team-reviews/open', isManagerOrAbove, can('approve'), performanceController.openTeamReviews);
router.put('/reviews/:id', isManagerOrAbove, can('approve'), performanceController.updateReview);

module.exports = router;
