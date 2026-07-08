const express = require('express');
const payrollController = require('../controllers/payroll.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { isHROrAdmin, isEmployee } = require('../middleware/role.middleware');
const { validate } = require('../middleware/validation.middleware');
const { payrollGenerateRules, uuidParam, paginationQuery } = require('../utils/validators');

const router = express.Router();

router.use(authenticate);

router.post('/generate', isHROrAdmin, payrollGenerateRules, validate, payrollController.generate);
router.get('/my-payslips', isEmployee, paginationQuery, validate, payrollController.myPayslips);
router.get('/monthly-report', isHROrAdmin, payrollController.monthlyReport);
router.get('/payslip/:id/download', uuidParam('id'), validate, payrollController.downloadPayslip);
router.get('/:employeeId/payslips', isHROrAdmin, uuidParam('employeeId'), validate, payrollController.employeePayslips);
router.put('/:id/update', isHROrAdmin, uuidParam(), validate, payrollController.update);

module.exports = router;
