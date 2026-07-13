const express = require('express');
const performanceController = require('../controllers/performance.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { isManagerOrAbove } = require('../middleware/role.middleware');

const router = express.Router();

router.use(authenticate);

router.get('/goals', performanceController.myGoals);
router.post('/goals', performanceController.createGoal);
router.put('/goals/:id', performanceController.updateGoal);
router.get('/cycles', performanceController.cycles);
router.get('/team-reviews', isManagerOrAbove, performanceController.teamReviews);

module.exports = router;
