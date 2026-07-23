const express = require('express');
const companyController = require('../controllers/company.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { isAdmin, isHROrAdmin } = require('../middleware/role.middleware');
const { validate } = require('../middleware/validation.middleware');
const { upload } = require('../middleware/upload.middleware');
const { body, param } = require('express-validator');

const router = express.Router();

router.use(authenticate);

const createChildRules = [
  body('name').trim().isLength({ min: 2, max: 200 }).withMessage('Company name is required'),
  body('slug').optional({ nullable: true }).trim().isLength({ max: 100 }),
];

const updateChildRules = [
  param('id').isUUID(),
  body('name').optional().trim().isLength({ min: 2, max: 200 }),
  body('is_active').optional().isBoolean(),
  body('isActive').optional().isBoolean(),
];

const companyIdParam = [param('id').isUUID()];

// HR + Admin can list companies for employee assignment
router.get('/me', isHROrAdmin, companyController.getMe);
router.get('/accessible', isHROrAdmin, companyController.listAccessible);

// Only Admin manages child companies
router.get('/children', isAdmin, companyController.listChildren);
router.post('/children', isAdmin, createChildRules, validate, companyController.createChild);
router.patch('/children/:id', isAdmin, updateChildRules, validate, companyController.updateChild);

// Org-scoped company detail actions (Admin)
router.get('/:id/employees', isAdmin, companyIdParam, validate, companyController.listEmployees);
router.post('/:id/logo', isAdmin, companyIdParam, validate, upload.single('logo'), companyController.uploadLogo);

module.exports = router;
