const payrollService = require('../services/payroll.service');
const { logAudit } = require('../services/auditLog.service');
const { successResponse } = require('../utils/helpers');
const logger = require('../utils/logger');

const initializeMonth = async (req, res, next) => {
  try {
    const { month, year } = req.body;
    const companyId = req.user.company_id || require('../utils/tenant').getCompanyId(req.user);
    const data = await payrollService.initializeMonth(month, year, req.user.id, companyId);
    successResponse(res, 'Payroll month initialized', data, null, 201);
  } catch (err) { next(err); }
};

const getMonthStatus = async (req, res, next) => {
  try {
    const month = parseInt(req.query.month, 10);
    const year = parseInt(req.query.year, 10);
    const companyId = req.user.company_id || require('../utils/tenant').getCompanyId(req.user);
    const data = await payrollService.getMonthStatus(month, year, companyId);
    successResponse(res, 'Payroll month fetched', data);
  } catch (err) { next(err); }
};

const generatePayslip = async (req, res, next) => {
  try {
    const { payroll_month_id, user_id } = req.body;
    if (user_id) {
      const ids = await require('../services/tenant.service')
        .getOrgEmployeeIds(req.user.company_id);
      if (!ids.includes(user_id)) {
        throw new (require('../utils/errors').NotFoundError)('Employee not found');
      }
    }
    const data = user_id
      ? await payrollService.generateDraftPayslip(payroll_month_id, user_id, req.user.company_id)
      : await payrollService.generateAllDraftPayslips(payroll_month_id, req.user.company_id);
    successResponse(res, user_id ? 'Draft payslip generated' : 'Draft payslips generated', data, null, 201);
  } catch (err) { next(err); }
};

const publishPayslip = async (req, res, next) => {
  try {
    const data = await payrollService.publishPayslip(req.params.id, req.user);
    logAudit({
      companyId: req.user.company_id || require('../utils/tenant').getCompanyId(req.user),
      actorId: req.user.id, actorRole: req.user.role,
      actionType: 'payroll.publish', targetType: 'payslip', targetId: req.params.id,
      ipAddress: req.ip,
    }).catch((e) => logger.warn('Audit log failed', { error: e.message }));
    successResponse(res, 'Payslip published', data);
  } catch (err) { next(err); }
};

const listPayslips = async (req, res, next) => {
  try {
    const month = parseInt(req.query.month, 10);
    const year = parseInt(req.query.year, 10);
    const mine = String(req.query.mine || '').toLowerCase() === 'true' || req.query.mine === '1';
    const result = await payrollService.listPayslips({
      month,
      year,
      user: req.user,
      role: req.user.role,
      mine,
      companyId: req.user.company_id,
      pageQuery: req.query,
    });
    successResponse(res, 'Payslips fetched', result.data, result.meta);
  } catch (err) { next(err); }
};

const downloadPayslip = async (req, res, next) => {
  try {
    const { buffer, filename } = await payrollService.downloadPayslip(req.params.id, req.user);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Cache-Control', 'no-store');
    return res.send(buffer);
  } catch (err) { next(err); }
};

const recalculateFromSettings = async (req, res, next) => {
  try {
    const month = req.body?.month != null ? parseInt(req.body.month, 10) : undefined;
    const year = req.body?.year != null ? parseInt(req.body.year, 10) : undefined;
    const employeeId = req.body?.employee_id || req.body?.employeeId || undefined;
    if (employeeId) {
      const ids = await require('../services/tenant.service')
        .getOrgEmployeeIds(req.user.company_id);
      if (!ids.includes(employeeId)) {
        throw new (require('../utils/errors').NotFoundError)('Employee not found');
      }
    }
    // background: answer now, recalculate on the server (Payroll Settings
    // autosave). Without it the caller waits for the result, as before.
    if (req.body?.background === true && !employeeId) {
      const queued = payrollService.queueRecalculationFromSettings({ month, year, companyId: req.user.company_id });
      return successResponse(res, 'Payslip recalculation started', queued, null, 202);
    }
    const data = await payrollService.recalculatePayslipsFromSettings({
      month, year, employeeId, companyId: req.user.company_id,
    });
    successResponse(res, 'Payslips recalculated from settings', data);
  } catch (err) { next(err); }
};

/** Monthly pay under current settings, for the employee profile. HR/Admin
 *  for anyone in their organisation; everyone else only for themselves. */
const salaryPreview = async (req, res, next) => {
  try {
    const employeeId = req.params.employeeId;
    const privileged = ['hr', 'admin'].includes(req.user.role);
    if (String(employeeId) !== String(req.user.id)) {
      if (!privileged) throw new (require('../utils/errors').ForbiddenError)('Not authorized to view this salary');
      const ids = await require('../services/tenant.service').getOrgEmployeeIds(req.user.company_id);
      if (!ids.includes(employeeId)) throw new (require('../utils/errors').NotFoundError)('Employee not found');
    }
    successResponse(res, 'Salary preview', await payrollService.previewEmployeeSalary(employeeId));
  } catch (err) { next(err); }
};

/** An employee in the caller's organisation, or 404. */
const assertInOrg = async (req, employeeId) => {
  const ids = await require('../services/tenant.service').getOrgEmployeeIds(req.user.company_id);
  if (!ids.includes(employeeId)) throw new (require('../utils/errors').NotFoundError)('Employee not found');
};

/** Which deductions apply to one employee. HR/Admin only. */
const getPayrollSetup = async (req, res, next) => {
  try {
    await assertInOrg(req, req.params.employeeId);
    successResponse(res, 'Payroll setup', await payrollService.getPayrollSetup(req.params.employeeId));
  } catch (err) { next(err); }
};

/** Switch an employee's PF / ESI / PT / TDS / extra deductions. HR can't change their own. */
const updatePayrollSetup = async (req, res, next) => {
  try {
    const employeeId = req.params.employeeId;
    await assertInOrg(req, employeeId);
    if (req.user.role === 'hr' && String(employeeId) === String(req.user.id)) {
      throw new (require('../utils/errors').ForbiddenError)('You cannot change your own payroll setup — an admin has to.');
    }
    const b = req.body || {};
    const result = await payrollService.updatePayrollSetup({
      employeeId,
      changes: {
        pf: b.pf,
        vpfPercent: b.vpfPercent,
        esi: b.esi,
        pt: b.pt,
        ptState: b.ptState,
        tdsMode: b.tdsMode,
        tdsFixed: b.tdsFixed,
        optouts: b.optouts,
        isPwd: b.isPwd,
        epsEligible: b.epsEligible,
        statutoryIds: b.statutoryIds,
        tax: b.tax,
      },
      actor: req.user,
      ipAddress: req.ip,
    });
    successResponse(res, result.changes.length ? 'Payroll setup updated' : 'Nothing changed', result);
  } catch (err) { next(err); }
};

const saveRules = async (req, res, next) => {
  try {
    const result = await payrollService.savePayrollRules(req.user.company_id, req.body?.rules ?? req.body, req.user);
    logAudit({
      companyId: req.user.company_id, actorId: req.user.id, actorRole: req.user.role,
      actionType: 'settings.payroll_rules.update', targetType: 'settings', targetId: null,
      afterState: result.rules, ipAddress: req.ip,
    }).catch(() => {});
    successResponse(res, 'Pay rules saved', result);
  } catch (err) { next(err); }
};

/** What to sort out before generating a month's payslips — read-only. */
const checks = async (req, res, next) => {
  try {
    const month = parseInt(req.query.month, 10);
    const year = parseInt(req.query.year, 10);
    successResponse(res, 'Payroll checks', await payrollService.getPayrollChecks(month, year, req.user.company_id));
  } catch (err) { next(err); }
};

/** The month's bank upload file (published payslips, net payable), as CSV. */
const bankFile = async (req, res, next) => {
  try {
    const paymentService = require('../services/payrollPayment.service');
    const { csv, filename, count, total, skipped } = await paymentService.getBankFile(req.user.company_id, req.query.month, req.query.year);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Bank-File-Rows', String(count));
    res.setHeader('X-Bank-File-Total', String(total));
    res.setHeader('X-Bank-File-Skipped', String(skipped.length));
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, X-Bank-File-Rows, X-Bank-File-Total, X-Bank-File-Skipped');
    return res.send(csv);
  } catch (err) { next(err); }
};

/** A month's statutory upload file — EPF ECR (text) or ESI (CSV) — from published payslips. */
const statutoryFile = (kind) => async (req, res, next) => {
  try {
    const files = require('../services/statutoryFiles.service');
    const result = kind === 'ecr'
      ? await files.getEcrFile(req.user.company_id, req.query.month, req.query.year)
      : await files.getEsiFile(req.user.company_id, req.query.month, req.query.year);
    res.setHeader('Content-Type', kind === 'ecr' ? 'text/plain; charset=utf-8' : 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-File-Rows', String(result.members));
    res.setHeader('X-File-Skipped', String(result.skipped.length));
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, X-File-Rows, X-File-Skipped');
    return res.send(kind === 'ecr' ? result.text : result.csv);
  } catch (err) { next(err); }
};
/** Do the month's payslips, register, bank file and journal agree? (read-only) */
const reconciliation = async (req, res, next) => {
  try {
    const reports = require('../services/payrollReports.service');
    successResponse(res, 'Reconciliation', await reports.getReconciliation(req.user.company_id, req.query.month, req.query.year));
  } catch (err) { next(err); }
};

/** A month's salary register or accounting journal, as CSV, from published payslips. */
const payrollReport = (kind) => async (req, res, next) => {
  try {
    const reports = require('../services/payrollReports.service');
    let result;
    if (kind === 'journal') result = await reports.getJournal(req.user.company_id, req.query.month, req.query.year);
    else if (kind === 'pt' || kind === 'lwf') result = await reports.getStateRegister(req.user.company_id, req.query.month, req.query.year, kind);
    else result = await reports.getSalaryRegister(req.user.company_id, req.query.month, req.query.year);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    return res.send(`\uFEFF${result.csv}`);
  } catch (err) { next(err); }
};
const salaryRegister = payrollReport('register');
const journal = payrollReport('journal');
const ptRegister = payrollReport('pt');
const lwfRegister = payrollReport('lwf');

const ecrFile = statutoryFile('ecr');
const esiFile = statutoryFile('esi');

// ── Tax declarations (Form 124): the employee declares, HR checks ───────
const declarations = () => require('../services/taxDeclaration.service');

/** The signed-in employee's own declaration for a tax year. */
const myTaxDeclaration = async (req, res, next) => {
  try {
    successResponse(res, 'Tax declaration', await declarations().getMyDeclaration(req.user, req.query.taxYear));
  } catch (err) { next(err); }
};

/** The employee saves their declaration, or sends it to HR (submit: true). */
const saveMyTaxDeclaration = async (req, res, next) => {
  try {
    const saved = await declarations().saveMyDeclaration(req.user, req.body || {});
    successResponse(res, saved.status === 'submitted' ? 'Sent to HR for checking' : 'Saved', saved);
  } catch (err) { next(err); }
};

/** HR: the company's declarations for a tax year. */
const listTaxDeclarations = async (req, res, next) => {
  try {
    successResponse(res, 'Tax declarations', await declarations().listDeclarations(req.user.company_id, {
      taxYear: req.query.taxYear, status: req.query.status,
    }));
  } catch (err) { next(err); }
};

/** HR accepts a declaration with the amounts allowed (they go into the employee's TDS). */
const verifyTaxDeclaration = async (req, res, next) => {
  try {
    const b = req.body || {};
    successResponse(res, 'Declaration accepted', await declarations().verifyDeclaration({
      id: req.params.id, companyId: req.user.company_id, actor: req.user, allowed: b.allowed, regime: b.regime, note: b.note, ipAddress: req.ip,
    }));
  } catch (err) { next(err); }
};

/** HR sends a declaration back with a note. */
const returnTaxDeclaration = async (req, res, next) => {
  try {
    successResponse(res, 'Declaration sent back', await declarations().returnDeclaration({
      id: req.params.id, companyId: req.user.company_id, actor: req.user, note: req.body?.note, ipAddress: req.ip,
    }));
  } catch (err) { next(err); }
};

// ── Loans and salary advances, recovered through payroll ─────────────────
const loans = () => require('../services/employeeLoan.service');

/** An employee's loans (HR), or your own (anyone, read-only). */
const listLoans = async (req, res, next) => {
  try {
    const own = req.params.employeeId === undefined;
    const employeeId = own ? req.user.id : req.params.employeeId;
    if (!own) await assertInOrg(req, employeeId);
    successResponse(res, 'Loans', await loans().listLoans(req.user.company_id, employeeId));
  } catch (err) { next(err); }
};

/** HR records a loan or advance for an employee. */
const createLoan = async (req, res, next) => {
  try {
    await assertInOrg(req, req.params.employeeId);
    const b = req.body || {};
    successResponse(res, 'Loan recorded', await loans().createLoan({
      companyId: req.user.company_id,
      employeeId: req.params.employeeId,
      actor: req.user,
      kind: b.kind,
      principal: b.principal,
      instalment: b.instalment,
      startMonth: b.startMonth,
      startYear: b.startYear,
      note: b.note,
      ipAddress: req.ip,
    }), null, 201);
  } catch (err) { next(err); }
};

/** HR cancels a loan entered by mistake (nothing recovered yet). */
const cancelLoan = async (req, res, next) => {
  try {
    await assertInOrg(req, req.params.employeeId);
    successResponse(res, 'Loan cancelled', await loans().cancelLoan({
      companyId: req.user.company_id, employeeId: req.params.employeeId, loanId: req.params.loanId, actor: req.user, ipAddress: req.ip,
    }));
  } catch (err) { next(err); }
};

// ── One-time pay and recoveries on a month's payslip ─────────────────────
const oneTime = () => require('../services/oneTimePay.service');

/** An employee's one-time pay and recoveries (HR). */
const listOneTimePay = async (req, res, next) => {
  try {
    await assertInOrg(req, req.params.employeeId);
    successResponse(res, 'One-time pay', await oneTime().listItems(req.user.company_id, req.params.employeeId));
  } catch (err) { next(err); }
};

/** HR adds one-time pay or a recovery to a month's payslip. */
const createOneTimePay = async (req, res, next) => {
  try {
    await assertInOrg(req, req.params.employeeId);
    const b = req.body || {};
    successResponse(res, 'Added', await oneTime().createItem({
      companyId: req.user.company_id,
      employeeId: req.params.employeeId,
      actor: req.user,
      month: b.month,
      year: b.year,
      kind: b.kind,
      name: b.name,
      amount: b.amount,
      taxable: b.taxable,
      pfWage: b.pfWage,
      esiWage: b.esiWage,
      note: b.note,
      ipAddress: req.ip,
    }), null, 201);
  } catch (err) { next(err); }
};

/** HR removes one while its month's payslip isn't published. */
const cancelOneTimePay = async (req, res, next) => {
  try {
    await assertInOrg(req, req.params.employeeId);
    successResponse(res, 'Removed', await oneTime().cancelItem({
      companyId: req.user.company_id, employeeId: req.params.employeeId, itemId: req.params.itemId, actor: req.user, ipAddress: req.ip,
    }));
  } catch (err) { next(err); }
};

// ── Changes after publishing: last month worked out again ─────────────────
const adjustments = () => require('../services/payrollAdjustments.service');

/** Last month's published payslips whose pay comes out different today (read-only). */
const listAdjustments = async (req, res, next) => {
  try {
    successResponse(res, 'Adjustments', await adjustments().findAdjustments(req.user.company_id, req.query.month, req.query.year));
  } catch (err) { next(err); }
};

/** Add the chosen differences to this month's payslips as arrears or recoveries. */
const applyAdjustments = async (req, res, next) => {
  try {
    const b = req.body || {};
    successResponse(res, 'Adjustments added', await adjustments().applyAdjustments({
      companyId: req.user.company_id, month: b.month, year: b.year, employeeIds: b.employeeIds, actor: req.user, ipAddress: req.ip,
    }));
  } catch (err) { next(err); }
};

// ── Full and final settlement ─────────────────────────────────────────────
const fnf = () => require('../services/fullAndFinal.service');

/** What a leaver's settlement comes to, for HR to review (read-only). */
const previewFullAndFinal = async (req, res, next) => {
  try {
    await assertInOrg(req, req.params.employeeId);
    successResponse(res, 'Full and final', await fnf().previewFullAndFinal({
      companyId: req.user.company_id, employeeId: req.params.employeeId, inputs: req.body || {},
    }));
  } catch (err) { next(err); }
};

/** Add the settlement to the final payslip as one-time pay. */
const applyFullAndFinal = async (req, res, next) => {
  try {
    await assertInOrg(req, req.params.employeeId);
    successResponse(res, 'Added to the final payslip', await fnf().applyFullAndFinal({
      companyId: req.user.company_id, employeeId: req.params.employeeId, actor: req.user, inputs: req.body || {}, ipAddress: req.ip,
    }));
  } catch (err) { next(err); }
};

/** Make the final payslip's draft once the last working day is over. */
const generateFinalPayslip = async (req, res, next) => {
  try {
    await assertInOrg(req, req.params.employeeId);
    if (String(req.params.employeeId) === String(req.user.id)) {
      throw new (require('../utils/errors').ForbiddenError)('You cannot make your own final payslip — an admin has to.');
    }
    successResponse(res, 'Final payslip drafted', await fnf().generateFinalPayslip({
      companyId: req.user.company_id, employeeId: req.params.employeeId, actor: req.user,
    }), null, 201);
  } catch (err) { next(err); }
};

/** HR records that the bank paid these published payslips (date + UTR). */
const markPaid = async (req, res, next) => {
  try {
    const paymentService = require('../services/payrollPayment.service');
    const b = req.body || {};
    const result = await paymentService.markPaid({
      companyId: req.user.company_id, payslipIds: b.payslipIds, paidOn: b.paidOn, reference: b.reference, actor: req.user, ipAddress: req.ip,
    });
    successResponse(res, `${result.updated} payslip${result.updated === 1 ? '' : 's'} marked paid`, result);
  } catch (err) { next(err); }
};

/** An employee's annual salary and tax statement (the figures for Form 130 Part B). */
const annualTaxStatement = async (req, res, next) => {
  try {
    const own = req.params.employeeId === undefined;
    const employeeId = own ? req.user.id : req.params.employeeId;
    if (!own) await assertInOrg(req, employeeId);
    const statement = await require('../services/annualTaxStatement.service')
      .getAnnualTaxStatement(req.user.company_id, employeeId, req.query.taxYear);
    successResponse(res, 'Annual tax statement', statement);
  } catch (err) { next(err); }
};

/** Salary TDS register for a tax year — published payslips only, read-only. */
const tdsRegister = async (req, res, next) => {
  try {
    const tdsRegisterService = require('../services/tdsRegister.service');
    successResponse(res, 'TDS register', await tdsRegisterService.getTdsRegister(req.user.company_id, req.query.taxYear));
  } catch (err) { next(err); }
};

/** The quarter's deductee rows for the TDS statement (Form 138), as CSV. */
const form138Csv = async (req, res, next) => {
  try {
    const tdsRegisterService = require('../services/tdsRegister.service');
    const { csv, filename } = await tdsRegisterService.getForm138Csv(req.user.company_id, req.query.taxYear, req.query.quarter);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    // A byte-order mark, so spreadsheet apps read the file as UTF-8.
    return res.send(`﻿${csv}`);
  } catch (err) { next(err); }
};

/** Approve a draft payslip (approval before publishing). */
const approvePayslip = async (req, res, next) => {
  try {
    successResponse(res, 'Payslip approved', await payrollService.approvePayslip(req.params.id, req.user, { ipAddress: req.ip }));
  } catch (err) { next(err); }
};

/** Approve every draft of a month that can be approved. */
const approveMonth = async (req, res, next) => {
  try {
    const b = req.body || {};
    const result = await payrollService.approveMonth(b.month, b.year, req.user, { ipAddress: req.ip });
    successResponse(res, `${result.approved} payslip${result.approved === 1 ? '' : 's'} approved`, result);
  } catch (err) { next(err); }
};

/** A yearly CTC split into a monthly salary by the company's template (read-only). */
const ctcSplit = async (req, res, next) => {
  try {
    successResponse(res, 'CTC split', await payrollService.splitCtc(req.user.company_id, req.body || {}));
  } catch (err) { next(err); }
};

/** The legal values and the standard behind Settings → Payroll → Calculation (read-only). */
const calcDefaults = async (req, res, next) => {
  try {
    successResponse(res, 'Calculation defaults', payrollService.getCalcDefaults());
  } catch (err) { next(err); }
};

/** Pay simulator — nothing is stored. A real employee must be in the caller's organisation. */
const simulate = async (req, res, next) => {
  try {
    const body = req.body || {};
    if (body.employeeId) await assertInOrg(req, body.employeeId);
    successResponse(res, 'Simulated pay', await payrollService.simulatePay(req.user.company_id, body));
  } catch (err) { next(err); }
};

module.exports = {
  ctcSplit,
  approvePayslip,
  approveMonth,
  calcDefaults,
  getPayrollSetup,
  updatePayrollSetup,
  tdsRegister,
  form138Csv,
  annualTaxStatement,
  bankFile,
  markPaid,
  ecrFile,
  esiFile,
  salaryRegister,
  ptRegister,
  lwfRegister,
  reconciliation,
  journal,
  listLoans,
  createLoan,
  cancelLoan,
  listOneTimePay,
  createOneTimePay,
  cancelOneTimePay,
  previewFullAndFinal,
  applyFullAndFinal,
  generateFinalPayslip,
  listAdjustments,
  applyAdjustments,
  myTaxDeclaration,
  saveMyTaxDeclaration,
  listTaxDeclarations,
  verifyTaxDeclaration,
  returnTaxDeclaration,
  saveRules,
  simulate,
  checks,
  salaryPreview,
  initializeMonth,
  getMonthStatus,
  generatePayslip,
  publishPayslip,
  listPayslips,
  downloadPayslip,
  recalculateFromSettings,
};
