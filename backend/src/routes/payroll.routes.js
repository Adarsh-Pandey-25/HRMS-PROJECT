const express = require('express');
const payrollController = require('../controllers/payroll.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { isHROrAdmin, isEmployee } = require('../middleware/role.middleware');
const { validate } = require('../middleware/validation.middleware');
const { requireFeature } = require('../middleware/featureGate.middleware');
const {
  payrollMonthRules,
  payrollMonthQueryRules,
  payrollGeneratePayslipRules,
  payrollListQueryRules,
  uuidParam,
} = require('../utils/validators');

const router = express.Router();

router.use(authenticate);
// Item 7: full-module gate, default OFF per company — covers every route
// below, including historical payslip viewing/download, not just running
// new payroll.
router.use(requireFeature('payroll'));

router.post('/months', isHROrAdmin, payrollMonthRules, validate, payrollController.initializeMonth);
router.get('/months', isEmployee, payrollMonthQueryRules, validate, payrollController.getMonthStatus);
router.post('/payslips/generate', isHROrAdmin, payrollGeneratePayslipRules, validate, payrollController.generatePayslip);
router.post('/payslips/recalculate-from-settings', isHROrAdmin, payrollController.recalculateFromSettings);
router.put('/payslips/:id/publish', isHROrAdmin, uuidParam(), validate, payrollController.publishPayslip);
router.get('/payslips', isEmployee, payrollListQueryRules, validate, payrollController.listPayslips);
router.get('/payslips/:id/download', uuidParam(), validate, payrollController.downloadPayslip);

module.exports = router;
