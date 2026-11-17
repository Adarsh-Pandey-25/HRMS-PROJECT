const express = require('express');
const reimbursementController = require('../controllers/reimbursement.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { isHROrAdmin, isManagerOrAbove, isEmployee } = require('../middleware/role.middleware');
const { upload } = require('../middleware/upload.middleware');
const { validate } = require('../middleware/validation.middleware');
const { requirePermission } = require('../middleware/requirePermission');
const { reimbursementRules, uuidParam, paginationQuery } = require('../utils/validators');

const router = express.Router();

router.use(authenticate);

// Settings → User & Role Management → Expense Claims. The approval queue lists
// claims too, so Approve also lets someone read them. A person's own claims
// never need it.
const can = (action) => requirePermission('expenses', action);

router.post('/submit', isEmployee, upload.single('receipt'), reimbursementRules, validate, reimbursementController.submit);
router.get('/my-reimbursements', isEmployee, paginationQuery, validate, reimbursementController.myReimbursements);
router.get('/team-reimbursements', isManagerOrAbove, can(['view', 'approve']), paginationQuery, validate, reimbursementController.teamReimbursements);
router.get('/all-reimbursements', isHROrAdmin, can(['view', 'approve']), paginationQuery, validate, reimbursementController.allReimbursements);
router.get('/:id/receipt', isEmployee, uuidParam(), validate, reimbursementController.receipt);
router.put('/:id/approve', isManagerOrAbove, can('approve'), uuidParam(), validate, reimbursementController.approve);
router.put('/:id/reject', isManagerOrAbove, can('approve'), uuidParam(), validate, reimbursementController.reject);
router.delete('/:id', isEmployee, uuidParam(), validate, reimbursementController.remove);

module.exports = router;
