const express = require('express');
const performanceController = require('../controllers/performance.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { isManagerOrAbove, isHROrAdmin } = require('../middleware/role.middleware');

const router = express.Router();

router.use(authenticate);

router.get('/goals', performanceController.myGoals);
router.post('/goals', performanceController.createGoal);
router.put('/goals/:id', performanceController.updateGoal);
router.get('/cycles', performanceController.cycles);
router.post('/cycles', isHROrAdmin, performanceController.createCycle);
router.get('/team-reviews', isManagerOrAbove, performanceController.teamReviews);
router.post('/team-reviews/open', isManagerOrAbove, performanceController.openTeamReviews);
router.put('/reviews/:id', isManagerOrAbove, performanceController.updateReview);

module.exports = router;
