const express = require('express');
const payrollController = require('../controllers/payroll.controller');
const salaryRevisionController = require('../controllers/salaryRevision.controller');
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
  salaryRevisionCreateRules,
  salaryRevisionListQueryRules,
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
router.put('/payslips/:id/approve', isHROrAdmin, uuidParam(), validate, payrollController.approvePayslip);
router.post('/payslips/approve-month', isHROrAdmin, payrollController.approveMonth);
router.get('/payslips', isEmployee, payrollListQueryRules, validate, payrollController.listPayslips);
router.get('/payslips/:id/download', uuidParam(), validate, payrollController.downloadPayslip);
router.get('/salary-preview/:employeeId', isEmployee, uuidParam('employeeId'), validate, payrollController.salaryPreview);
router.get('/setup/:employeeId', isHROrAdmin, uuidParam('employeeId'), validate, payrollController.getPayrollSetup);
router.put('/setup/:employeeId', isHROrAdmin, uuidParam('employeeId'), validate, payrollController.updatePayrollSetup);
router.put('/rules', isHROrAdmin, payrollController.saveRules);
router.post('/simulate', isHROrAdmin, payrollController.simulate);
router.get('/calc-defaults', isHROrAdmin, payrollController.calcDefaults);
router.post('/ctc-split', isHROrAdmin, payrollController.ctcSplit);
router.get('/checks', isHROrAdmin, payrollMonthQueryRules, validate, payrollController.checks);
router.get('/tds/register', isHROrAdmin, payrollController.tdsRegister);
router.get('/tds/form138', isHROrAdmin, payrollController.form138Csv);
router.get('/tds/statement/me', isEmployee, payrollController.annualTaxStatement);
router.get('/tds/statement/:employeeId', isHROrAdmin, uuidParam('employeeId'), validate, payrollController.annualTaxStatement);
router.get('/bank-file', isHROrAdmin, payrollMonthQueryRules, validate, payrollController.bankFile);
router.post('/payments/mark-paid', isHROrAdmin, payrollController.markPaid);
router.get('/statutory/ecr', isHROrAdmin, payrollMonthQueryRules, validate, payrollController.ecrFile);
router.get('/statutory/esi', isHROrAdmin, payrollMonthQueryRules, validate, payrollController.esiFile);
router.get('/reports/register', isHROrAdmin, payrollMonthQueryRules, validate, payrollController.salaryRegister);
router.get('/reports/pt-register', isHROrAdmin, payrollMonthQueryRules, validate, payrollController.ptRegister);
router.get('/reports/lwf-register', isHROrAdmin, payrollMonthQueryRules, validate, payrollController.lwfRegister);
router.get('/reports/reconciliation', isHROrAdmin, payrollMonthQueryRules, validate, payrollController.reconciliation);
router.get('/reports/journal', isHROrAdmin, payrollMonthQueryRules, validate, payrollController.journal);
router.get('/loans/me', isEmployee, payrollController.listLoans);
router.get('/loans/:employeeId', isHROrAdmin, uuidParam('employeeId'), validate, payrollController.listLoans);
router.post('/loans/:employeeId', isHROrAdmin, uuidParam('employeeId'), validate, payrollController.createLoan);
router.post('/loans/:employeeId/:loanId/cancel', isHROrAdmin, uuidParam('employeeId'), uuidParam('loanId'), validate, payrollController.cancelLoan);
router.get('/one-time/:employeeId', isHROrAdmin, uuidParam('employeeId'), validate, payrollController.listOneTimePay);
router.post('/one-time/:employeeId', isHROrAdmin, uuidParam('employeeId'), validate, payrollController.createOneTimePay);
router.post('/one-time/:employeeId/:itemId/cancel', isHROrAdmin, uuidParam('employeeId'), uuidParam('itemId'), validate, payrollController.cancelOneTimePay);
router.post('/fnf/:employeeId/preview', isHROrAdmin, uuidParam('employeeId'), validate, payrollController.previewFullAndFinal);
router.post('/fnf/:employeeId/apply', isHROrAdmin, uuidParam('employeeId'), validate, payrollController.applyFullAndFinal);
router.post('/fnf/:employeeId/generate', isHROrAdmin, uuidParam('employeeId'), validate, payrollController.generateFinalPayslip);
router.get('/adjustments', isHROrAdmin, payrollMonthQueryRules, validate, payrollController.listAdjustments);
router.post('/adjustments/apply', isHROrAdmin, payrollController.applyAdjustments);
router.get('/tax-declaration/me', isEmployee, payrollController.myTaxDeclaration);
router.put('/tax-declaration/me', isEmployee, payrollController.saveMyTaxDeclaration);
router.get('/tax-declarations', isHROrAdmin, payrollController.listTaxDeclarations);
router.post('/tax-declarations/:id/verify', isHROrAdmin, uuidParam(), validate, payrollController.verifyTaxDeclaration);
router.post('/tax-declarations/:id/return', isHROrAdmin, uuidParam(), validate, payrollController.returnTaxDeclaration);

router.get('/revisions', isHROrAdmin, salaryRevisionListQueryRules, validate, salaryRevisionController.list);
router.post('/revisions', isHROrAdmin, salaryRevisionCreateRules, validate, salaryRevisionController.create);
router.post('/revisions/:id/cancel', isHROrAdmin, uuidParam(), validate, salaryRevisionController.cancel);

module.exports = router;
