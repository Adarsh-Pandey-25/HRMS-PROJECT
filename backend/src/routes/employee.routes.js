const express = require('express');
const employeeController = require('../controllers/employee.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { isHROrAdmin, isManagerOrAbove } = require('../middleware/role.middleware');
const { validate } = require('../middleware/validation.middleware');
const { employeeCreateRules, uuidParam, employeeRefParam, paginationQuery } = require('../utils/validators');

const router = express.Router();

router.use(authenticate);

router.post('/create', isHROrAdmin, employeeCreateRules, validate, employeeController.create);
router.get('/all', isHROrAdmin, paginationQuery, validate, employeeController.getAll);
router.get('/team/:managerId', isManagerOrAbove, uuidParam('managerId'), validate, employeeController.getTeam);
router.get('/:id', employeeRefParam(), validate, employeeController.getById);
router.put('/:id/update', uuidParam(), validate, employeeController.update);
router.delete('/:id', isHROrAdmin, uuidParam(), validate, employeeController.remove);
router.put('/:id/deactivate', isHROrAdmin, uuidParam(), validate, employeeController.deactivate);

module.exports = router;
