const express = require('express');
const employeeController = require('../controllers/employee.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { isHROrAdmin, isManagerOrAbove } = require('../middleware/role.middleware');
const { upload } = require('../middleware/upload.middleware');
const { validate } = require('../middleware/validation.middleware');
const {
  employeeCreateRules, uuidParam, employeeRefParam, paginationQuery, careerNoteRules,
} = require('../utils/validators');

const router = express.Router();

router.use(authenticate);

router.post('/create', isHROrAdmin, employeeCreateRules, validate, employeeController.create);
router.get('/all', isHROrAdmin, paginationQuery, validate, employeeController.getAll);
router.get('/team/:managerId', isManagerOrAbove, uuidParam('managerId'), validate, employeeController.getTeam);
router.get('/:id', employeeRefParam(), validate, employeeController.getById);
router.put('/:id/update', uuidParam(), validate, employeeController.update);
router.post('/:id/photo', uuidParam(), validate, upload.single('photo'), employeeController.uploadPhoto);
router.get('/:id/career-events', uuidParam(), validate, employeeController.listCareerEvents);
router.post('/:id/career-events', uuidParam(), careerNoteRules, validate, employeeController.addCareerNote);
router.delete('/:id', isHROrAdmin, uuidParam(), validate, employeeController.remove);
router.put('/:id/deactivate', isHROrAdmin, uuidParam(), validate, employeeController.deactivate);

module.exports = router;
