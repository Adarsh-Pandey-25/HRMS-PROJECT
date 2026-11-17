const express = require('express');
const employeeController = require('../controllers/employee.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { isHROrAdmin, isManagerOrAbove } = require('../middleware/role.middleware');
const { upload } = require('../middleware/upload.middleware');
const { requirePermission } = require('../middleware/requirePermission');
const { validate } = require('../middleware/validation.middleware');
const {
  employeeCreateRules, uuidParam, employeeRefParam, paginationQuery, careerNoteRules,
} = require('../utils/validators');

const router = express.Router();

router.use(authenticate);

// Settings → User & Role Management → Employee Management. Bulk Import adds
// people through /create; the Directory's offboard and erase buttons show with
// Delete or Edit, so either allows them.
const can = (action) => requirePermission('employees', action);

router.post('/create', isHROrAdmin, can(['create', 'import']), employeeCreateRules, validate, employeeController.create);
router.get('/all', isHROrAdmin, can('view'), paginationQuery, validate, employeeController.getAll);
router.get('/team/:managerId', isManagerOrAbove, can('view'), uuidParam('managerId'), validate, employeeController.getTeam);
router.get('/:id', employeeRefParam(), validate, employeeController.getById);
router.put('/:id/update', employeeRefParam('id'), validate, employeeController.update);
router.post('/:id/photo', employeeRefParam('id'), validate, upload.single('photo'), employeeController.uploadPhoto);
router.get('/:id/career-events', uuidParam(), validate, employeeController.listCareerEvents);
router.post('/:id/career-events', uuidParam(), careerNoteRules, validate, employeeController.addCareerNote);
// DELETE here is a soft offboard (data retained) — N-10. Hard delete lives
// at its own explicit, separately-gated path below.
router.delete('/:id', isHROrAdmin, can(['delete', 'edit']), employeeRefParam('id'), validate, employeeController.offboard);
router.post('/:id/erase', isHROrAdmin, can(['delete', 'edit']), employeeRefParam('id'), validate, employeeController.permanentlyErase);
router.put('/:id/deactivate', isHROrAdmin, can(['edit', 'delete']), employeeRefParam('id'), validate, employeeController.deactivate);
router.post('/:id/reset-self-edit-lock', isHROrAdmin, can('edit'), employeeRefParam('id'), validate, employeeController.resetSelfEditLock);

module.exports = router;
