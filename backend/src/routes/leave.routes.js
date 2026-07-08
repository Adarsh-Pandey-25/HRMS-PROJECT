const express = require('express');
const leaveController = require('../controllers/leave.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { isHROrAdmin, isManagerOrAbove, isEmployee } = require('../middleware/role.middleware');
const { validate } = require('../middleware/validation.middleware');
const { leaveApplyRules, uuidParam, paginationQuery } = require('../utils/validators');

const router = express.Router();

router.use(authenticate);

router.post('/apply', isEmployee, leaveApplyRules, validate, leaveController.apply);
router.get('/my-leaves', isEmployee, paginationQuery, validate, leaveController.myLeaves);
router.get('/team-leaves', isManagerOrAbove, paginationQuery, validate, leaveController.teamLeaves);
router.get('/all-leaves', isHROrAdmin, paginationQuery, validate, leaveController.allLeaves);
router.put('/:id/approve', isManagerOrAbove, uuidParam(), validate, leaveController.approve);
router.put('/:id/reject', isManagerOrAbove, uuidParam(), validate, leaveController.reject);
router.delete('/:id/cancel', isEmployee, uuidParam(), validate, leaveController.cancel);
router.get('/balance/:employeeId', uuidParam('employeeId'), validate, leaveController.balance);
router.get('/calendar', leaveController.calendar);

module.exports = router;
