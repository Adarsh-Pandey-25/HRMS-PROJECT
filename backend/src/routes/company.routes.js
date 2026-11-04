const express = require('express');
const companyController = require('../controllers/company.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { isAdmin, isHROrAdmin } = require('../middleware/role.middleware');
const { requirePermission } = require('../middleware/permission.middleware');
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
router.get('/billing/seats', isHROrAdmin, companyController.seatUsage);
// Every authenticated role — nav filtering (item 5) needs this regardless of role.
router.get('/me/features', companyController.myFeatures);
// Every authenticated role — checked before any bulk export action (item 6).
router.get('/me/export-status', companyController.exportStatus);

// Adding a subsidiary and editing company details: Admin, and HR when
// Settings → User & Role Management allows it (Organizations → Create / Edit).
const canCreateCompanies = requirePermission('organizations', 'create', 'Your role can\'t add companies. An Admin can allow it in Settings → User & Role Management.');
const canEditCompanies = requirePermission('organizations', 'edit', 'Your role can\'t edit company details. An Admin can allow it in Settings → User & Role Management.');

// Listing child companies and switching them on or off: Admin only
router.get('/children', isAdmin, companyController.listChildren);
router.post('/children', canCreateCompanies, createChildRules, validate, companyController.createChild);
router.patch('/children/:id', isAdmin, updateChildRules, validate, companyController.updateChild);

// Org-scoped company detail actions (Admin / HR)
router.get('/:id/details', isHROrAdmin, companyIdParam, validate, companyController.getDetails);
router.patch('/:id/details', canEditCompanies, companyIdParam, validate, companyController.updateDetails);
router.get('/:id/employees', isAdmin, companyIdParam, validate, companyController.listEmployees);
router.post('/:id/logo', canEditCompanies, companyIdParam, validate, upload.single('logo'), companyController.uploadLogo);

module.exports = router;
