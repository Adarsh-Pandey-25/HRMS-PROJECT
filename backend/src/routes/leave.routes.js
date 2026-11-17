const express = require('express');
const leaveController = require('../controllers/leave.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { isHROrAdmin, isManagerOrAbove, isEmployee } = require('../middleware/role.middleware');
const { validate } = require('../middleware/validation.middleware');
const { requirePermission, isOwnId } = require('../middleware/requirePermission');
const { leaveApplyRules, uuidParam, paginationQuery } = require('../utils/validators');

const router = express.Router();

router.use(authenticate);

// Settings → User & Role Management → Leave Management. The approval queues
// list leaves too, so Approve also lets someone read them. A person's own
// leave and balance never need it.
const can = (action, options) => requirePermission('leave', action, options);

router.post('/apply', isEmployee, leaveApplyRules, validate, leaveController.apply);
router.get('/my-leaves', isEmployee, paginationQuery, validate, leaveController.myLeaves);
router.get('/team-leaves', isManagerOrAbove, can(['view', 'approve']), paginationQuery, validate, leaveController.teamLeaves);
router.get('/all-leaves', isHROrAdmin, can(['view', 'approve']), paginationQuery, validate, leaveController.allLeaves);
router.put('/:id/approve', isManagerOrAbove, can('approve'), uuidParam(), validate, leaveController.approve);
router.put('/:id/reject', isManagerOrAbove, can('approve'), uuidParam(), validate, leaveController.reject);
router.delete('/:id/cancel', isEmployee, uuidParam(), validate, leaveController.cancel);
router.get('/balance/:employeeId', can(['view', 'approve'], { selfService: (req) => isOwnId(req, req.params.employeeId) }), uuidParam('employeeId'), validate, leaveController.balance);
router.put('/balance/:employeeId', isHROrAdmin, can(['manage', 'approve']), uuidParam('employeeId'), validate, leaveController.setBalance);
router.get('/day-count', isEmployee, leaveController.dayCount);
router.get('/types', leaveController.types);
router.get('/calendar', leaveController.calendar);

module.exports = router;
