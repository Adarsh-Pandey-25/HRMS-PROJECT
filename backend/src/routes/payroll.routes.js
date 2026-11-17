const express = require('express');
const payrollController = require('../controllers/payroll.controller');
const salaryRevisionController = require('../controllers/salaryRevision.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { isHROrAdmin, isEmployee } = require('../middleware/role.middleware');
const { validate } = require('../middleware/validation.middleware');
const { requireFeature } = require('../middleware/featureGate.middleware');
const { requirePermission, isOwnId } = require('../middleware/requirePermission');
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
// Settings → User & Role Management → Payroll Processing → Manage: every HR
// payroll screen. A person's own payslips, tax and loans never need it.
const managePayroll = requirePermission('payroll', 'manage');
const managePayrollUnlessOwn = (isOwn) => requirePermission('payroll', 'manage', { selfService: isOwn });
// The payslip list is the company's for HR/Admin, unless they ask for their own ("mine").
const ownPayslips = (req) => !['hr', 'admin'].includes(req.user.role) || ['true', '1'].includes(String(req.query.mine).toLowerCase());
const ownEmployeeId = (req) => isOwnId(req, req.params.employeeId);

router.use(authenticate);
// Item 7: full-module gate, default OFF per company — covers every route
// below, including historical payslip viewing/download, not just running
// new payroll.
router.use(requireFeature('payroll'));

router.post('/months', isHROrAdmin, managePayroll, payrollMonthRules, validate, payrollController.initializeMonth);
router.get('/months', isEmployee, payrollMonthQueryRules, validate, payrollController.getMonthStatus);
router.post('/payslips/generate', isHROrAdmin, managePayroll, payrollGeneratePayslipRules, validate, payrollController.generatePayslip);
router.post('/payslips/recalculate-from-settings', isHROrAdmin, managePayroll, payrollController.recalculateFromSettings);
router.put('/payslips/:id/publish', isHROrAdmin, managePayroll, uuidParam(), validate, payrollController.publishPayslip);
router.put('/payslips/:id/approve', isHROrAdmin, managePayroll, uuidParam(), validate, payrollController.approvePayslip);
router.post('/payslips/approve-month', isHROrAdmin, managePayroll, payrollController.approveMonth);
router.post('/payslips/publish-month', isHROrAdmin, managePayroll, payrollController.publishMonth);
router.get('/payslips', isEmployee, managePayrollUnlessOwn(ownPayslips), payrollListQueryRules, validate, payrollController.listPayslips);
router.get('/payslips/:id/download', uuidParam(), validate, payrollController.downloadPayslip);
router.get('/salary-preview/:employeeId', isEmployee, managePayrollUnlessOwn(ownEmployeeId), uuidParam('employeeId'), validate, payrollController.salaryPreview);
router.get('/setup/:employeeId', isHROrAdmin, managePayroll, uuidParam('employeeId'), validate, payrollController.getPayrollSetup);
router.put('/setup/:employeeId', isHROrAdmin, managePayroll, uuidParam('employeeId'), validate, payrollController.updatePayrollSetup);
router.put('/rules', isHROrAdmin, managePayroll, payrollController.saveRules);
router.post('/simulate', isHROrAdmin, managePayroll, payrollController.simulate);
router.get('/calc-defaults', isHROrAdmin, managePayroll, payrollController.calcDefaults);
router.post('/ctc-split', isHROrAdmin, managePayroll, payrollController.ctcSplit);
router.get('/checks', isHROrAdmin, managePayroll, payrollMonthQueryRules, validate, payrollController.checks);
router.get('/tds/register', isHROrAdmin, managePayroll, payrollController.tdsRegister);
router.get('/tds/form138', isHROrAdmin, managePayroll, payrollController.form138Csv);
router.get('/tds/statement/me', isEmployee, payrollController.annualTaxStatement);
router.get('/tds/statement/:employeeId', isHROrAdmin, managePayroll, uuidParam('employeeId'), validate, payrollController.annualTaxStatement);
router.get('/bank-file', isHROrAdmin, managePayroll, payrollMonthQueryRules, validate, payrollController.bankFile);
router.post('/payments/mark-paid', isHROrAdmin, managePayroll, payrollController.markPaid);
router.post('/payments/mark-paid-month', isHROrAdmin, managePayroll, payrollController.markPaidMonth);
router.get('/statutory/ecr', isHROrAdmin, managePayroll, payrollMonthQueryRules, validate, payrollController.ecrFile);
router.get('/statutory/esi', isHROrAdmin, managePayroll, payrollMonthQueryRules, validate, payrollController.esiFile);
router.get('/reports/register', isHROrAdmin, managePayroll, payrollMonthQueryRules, validate, payrollController.salaryRegister);
router.get('/reports/pt-register', isHROrAdmin, managePayroll, payrollMonthQueryRules, validate, payrollController.ptRegister);
router.get('/reports/lwf-register', isHROrAdmin, managePayroll, payrollMonthQueryRules, validate, payrollController.lwfRegister);
router.get('/reports/reconciliation', isHROrAdmin, managePayroll, payrollMonthQueryRules, validate, payrollController.reconciliation);
router.get('/reports/journal', isHROrAdmin, managePayroll, payrollMonthQueryRules, validate, payrollController.journal);
router.get('/loans/me', isEmployee, payrollController.listLoans);
router.get('/loans/:employeeId', isHROrAdmin, managePayroll, uuidParam('employeeId'), validate, payrollController.listLoans);
router.post('/loans/:employeeId', isHROrAdmin, managePayroll, uuidParam('employeeId'), validate, payrollController.createLoan);
router.post('/loans/:employeeId/:loanId/cancel', isHROrAdmin, managePayroll, uuidParam('employeeId'), uuidParam('loanId'), validate, payrollController.cancelLoan);
router.get('/one-time/:employeeId', isHROrAdmin, managePayroll, uuidParam('employeeId'), validate, payrollController.listOneTimePay);
router.post('/one-time/:employeeId', isHROrAdmin, managePayroll, uuidParam('employeeId'), validate, payrollController.createOneTimePay);
router.post('/one-time/:employeeId/:itemId/cancel', isHROrAdmin, managePayroll, uuidParam('employeeId'), uuidParam('itemId'), validate, payrollController.cancelOneTimePay);
router.post('/fnf/:employeeId/preview', isHROrAdmin, managePayroll, uuidParam('employeeId'), validate, payrollController.previewFullAndFinal);
router.post('/fnf/:employeeId/apply', isHROrAdmin, managePayroll, uuidParam('employeeId'), validate, payrollController.applyFullAndFinal);
router.post('/fnf/:employeeId/generate', isHROrAdmin, managePayroll, uuidParam('employeeId'), validate, payrollController.generateFinalPayslip);
router.get('/adjustments', isHROrAdmin, managePayroll, payrollMonthQueryRules, validate, payrollController.listAdjustments);
router.post('/adjustments/apply', isHROrAdmin, managePayroll, payrollController.applyAdjustments);
router.get('/tax-declaration/me', isEmployee, payrollController.myTaxDeclaration);
router.put('/tax-declaration/me', isEmployee, payrollController.saveMyTaxDeclaration);
router.get('/tax-declarations', isHROrAdmin, managePayroll, payrollController.listTaxDeclarations);
router.post('/tax-declarations/:id/verify', isHROrAdmin, managePayroll, uuidParam(), validate, payrollController.verifyTaxDeclaration);
router.post('/tax-declarations/:id/return', isHROrAdmin, managePayroll, uuidParam(), validate, payrollController.returnTaxDeclaration);

router.get('/revisions', isHROrAdmin, managePayroll, salaryRevisionListQueryRules, validate, salaryRevisionController.list);
router.post('/revisions', isHROrAdmin, managePayroll, salaryRevisionCreateRules, validate, salaryRevisionController.create);
router.post('/revisions/:id/cancel', isHROrAdmin, managePayroll, uuidParam(), validate, salaryRevisionController.cancel);

module.exports = router;
