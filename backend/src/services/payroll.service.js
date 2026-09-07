const moment = require('moment-timezone');
const { supabaseAdmin } = require('../config/supabase');
const {
  BadRequestError, NotFoundError, ForbiddenError, ConflictError,
} = require('../utils/errors');
const { uploadPayslip, getSignedUrl, STORAGE_BUCKETS } = require('./storage.service');
const attendanceService = require('./attendance.service');
const logger = require('../utils/logger');
const { TIMEZONE } = require('../utils/constants');
const settingsService = require('./settings.service');
const notificationService = require('./notification.service');
const emailService = require('./email.service');
const { buildPayslipPdfBuffer } = require('./payslipPdf.service');
const { buildMeta } = require('../utils/helpers');

const WORKING_DAYS_PER_MONTH = 26;
const MONTH_STATUS = { PENDING: 'PENDING', COMPLETED: 'COMPLETED' };
const PAYSLIP_STATUS = { DRAFT: 'DRAFT', PUBLISHED: 'PUBLISHED' };
const PAYSLIP_EMPLOYEE_SELECT = 'id, first_name, last_name, employee_code, email, company_id, address, designation, date_of_joining, bank_details, salary_details, gender';

const round2 = (n) => Math.round(Number(n) * 100) / 100;

/**
 * Professional Tax by state. Modeled per-state explicitly rather than one
 * generic monthly-slab table, because the real statutory rules genuinely
 * differ in structure and forcing them into one shape produces silently
 * wrong deductions:
 *  - Tamil Nadu's published slab is assessed on HALF-YEARLY income, not
 *    monthly — applying it directly to monthly gross both misclassifies
 *    the bracket and deducts 6x too much every month.
 *  - Karnataka and Maharashtra both carry an extra amount in February so
 *    twelve monthly deductions reach the ₹2,500 statutory annual cap
 *    (₹200 × 11 + ₹300 = ₹2,500).
 *  - Maharashtra additionally exempts women earning up to ₹25,000/month
 *    entirely, in force since the April 2023 amendment — this is not a
 *    different slab, it overrides the general slab outright below that
 *    threshold regardless of which band the amount would otherwise fall in.
 * Covers the states offered in Settings → Payroll → PT State. Not
 * exhaustive — states not listed here (or an unresolved employee gender
 * where it matters) fall back to the flat configured payroll_professional_tax amount.
 *
 * @param {string} state
 * @param {number} gross monthly gross
 * @param {{ month?: number, gender?: string }} ctx month is 1-12 (calendar month being paid); gender is the employee's gender_type ('male'|'female'|'other')
 * @returns {number|null} the PT amount, or null when the state isn't modeled (caller falls back)
 */
const getProfessionalTaxForState = (state, gross, { month, gender } = {}) => {
  const normalizedState = String(state || '').trim();
  const isFeb = Number(month) === 2;

  switch (normalizedState) {
    case 'Karnataka':
      if (gross <= 24999) return 0;
      return isFeb ? 300 : 200;

    case 'Maharashtra':
      if (gender === 'female' && gross <= 25000) return 0;
      if (gross <= 7500) return 0;
      if (gross <= 10000) return 175;
      return isFeb ? 300 : 200;

    case 'Tamil Nadu': {
      // Convert monthly gross to its half-yearly equivalent to match the
      // published slab's real basis, then divide the half-yearly amount
      // back down to the equivalent monthly deduction.
      const halfYearlyGross = gross * 6;
      const halfYearlySlabs = [
        { upTo: 21000, amount: 0 },
        { upTo: 30000, amount: 135 },
        { upTo: 45000, amount: 315 },
        { upTo: 60000, amount: 690 },
        { upTo: 75000, amount: 1025 },
        { upTo: Infinity, amount: 1250 },
      ];
      const slab = halfYearlySlabs.find((s) => halfYearlyGross <= s.upTo) || halfYearlySlabs[halfYearlySlabs.length - 1];
      return round2(slab.amount / 6);
    }

    case 'Delhi':
      return 0; // No professional tax levied in Delhi

    case 'Telangana':
      if (gross <= 15000) return 0;
      if (gross <= 20000) return 150;
      return 200;

    default:
      return null;
  }
};

/**
 * Perfect contract payroll calculation.
 *
 * Earnings: Basic + HRA + DA + Special (+ salary custom allowances)
 * Gross    = sum(earnings)
 * LOP      = (Gross / weekdayCount) × (absent + 0.5×halfDay)   [from attendance]
 * PF       = Basic × rate (company payroll_pf_rate or employee pf_percent) unless pf_applicable=false
 * PT       = payroll_professional_tax (flat ₹) unless pt_applicable=false
 * TDS      = employee tds_mode company|fixed|none; company uses settings auto/manual
 * Custom   = from Settings → payroll_config.custom_payroll_options + payroll_components
 * Net      = Gross − all deductions
 */
const calculateContractPayslip = async (employee, attendanceSummary, month = null) => {
  const payslipMonth = Number(month) || (moment.tz(TIMEZONE).month() + 1);
  const { getCompanyId, DEFAULT_COMPANY_ID } = require('../utils/tenant');
  const companyId = getCompanyId(employee) || DEFAULT_COMPANY_ID;

  const workingDaysSetting = Math.max(1, await settingsService.getNumber('payroll_working_days', WORKING_DAYS_PER_MONTH, companyId));
  const pfRate = Math.max(0, await settingsService.getNumber('payroll_pf_rate', 0.12, companyId));
  const tdsPercent = Math.max(0, await settingsService.getNumber('payroll_tds_percent', 8, companyId));
  const esiEmployeePercent = Math.max(0, await settingsService.getNumber('payroll_esi_employee_percent', 0.75, companyId));
  const esiThreshold = Math.max(0, await settingsService.getNumber('payroll_esi_threshold', 21000, companyId));

  const payrollConfig = (await settingsService.getSetting('payroll_config', null, companyId)) || {};
  const pfWageCeiling = payrollConfig.pf_wage_ceiling != null
    ? Number(payrollConfig.pf_wage_ceiling)
    : null;
  const companyTdsMode = String(payrollConfig.tds_mode || 'auto');

  const salary = employee.salary_details || {};
  const basic = round2(Number(salary.basic || 0));
  const hra = round2(Number(salary.hra || 0));
  const da = round2(Number(salary.da || 0));
  const special = round2(Number(salary.special || 0));
  const transport = round2(Number(salary.transport || 0));
  const medical = round2(Number(salary.medical || 0));

  // Per-employee exceptions (defaults = follow company policy)
  const flagOn = (v, def = true) => {
    if (v === undefined || v === null || v === '') return def;
    if (typeof v === 'boolean') return v;
    const s = String(v).toLowerCase();
    if (['false', '0', 'no', 'off'].includes(s)) return false;
    if (['true', '1', 'yes', 'on'].includes(s)) return true;
    return Boolean(v);
  };
  const pfApplicable = flagOn(salary.pf_applicable ?? salary.pfApplicable, true);
  const ptApplicable = flagOn(salary.pt_applicable ?? salary.ptApplicable, true);
  const empPfPercent = salary.pf_percent ?? salary.pfPercent;
  const empPfRate = empPfPercent != null && empPfPercent !== ''
    ? Math.max(0, Number(empPfPercent) / 100)
    : pfRate;
  const empTdsMode = String(salary.tds_mode ?? salary.tdsMode ?? 'company').toLowerCase();
  // company | fixed | none — "company" follows payroll settings auto/manual

  const earnings = [
    { name: 'Basic', amount: basic },
    { name: 'HRA', amount: hra },
  ];
  if (da > 0) earnings.push({ name: 'DA', amount: da });
  if (special > 0) earnings.push({ name: 'Special Allowance', amount: special });
  if (transport > 0) earnings.push({ name: 'Transport Allowance', amount: transport });
  if (medical > 0) earnings.push({ name: 'Medical Allowance', amount: medical });

  let gross = round2(earnings.reduce((s, e) => s + Number(e.amount || 0), 0));

  // Custom allowances first so TDS/LOP use final gross
  const customOptions = Array.isArray(payrollConfig.custom_payroll_options)
    ? payrollConfig.custom_payroll_options
    : [];
  const pendingCustomDeductions = [];
  for (const opt of customOptions) {
    if (!opt || opt.active === false || !String(opt.name || '').trim()) continue;
    const name = String(opt.name).trim();
    const kind = String(opt.kind || opt.type || 'deduction').toLowerCase();
    const valueType = String(opt.value_type || opt.valueType || 'fixed').toLowerCase();
    const value = Number(opt.value || 0);
    const baseKey = String(opt.base || 'basic').toLowerCase();
    const baseAmt = baseKey === 'gross' ? gross : basic;
    const amount = valueType === 'percent'
      ? round2(baseAmt * (value / 100))
      : round2(value);
    if (amount <= 0) continue;

    if (kind === 'allowance' || kind === 'earning') {
      earnings.push({ name, amount });
      gross = round2(gross + amount);
    } else {
      pendingCustomDeductions.push({ name, amount });
    }
  }

  // LOP from real calendar weekdays + attendance absences (not setting − present)
  const weekdayCount = Math.max(
    1,
    Number(attendanceSummary?.workingDays || workingDaysSetting)
  );
  const absent = Number(attendanceSummary?.absent || 0);
  const halfDay = Number(attendanceSummary?.halfDay || 0);
  const unpaid_leave_days = round2(Math.max(0, absent + halfDay * 0.5));
  const lop_deduction = round2((gross / weekdayCount) * unpaid_leave_days);

  // PF on Basic (capped if wage ceiling configured) — skip if employee exempt
  const pfBase = pfWageCeiling != null && pfWageCeiling > 0
    ? Math.min(basic, pfWageCeiling)
    : basic;
  const pf_deduction = pfApplicable ? round2(pfBase * empPfRate) : 0;

  // Professional Tax — state-specific slab on gross when the configured PT state
  // has a known slab table; otherwise fall back to the flat configured amount.
  const ptState = String(payrollConfig.pt_state ?? payrollConfig.ptState ?? '').trim();
  const ptByState = getProfessionalTaxForState(ptState, gross, { month: payslipMonth, gender: employee?.gender });
  const ptFlatAmount = Math.max(0, await settingsService.getNumber('payroll_professional_tax', 200, companyId));
  const ptAmount = ptByState != null ? ptByState : ptFlatAmount;
  const professional_tax = ptApplicable ? round2(ptAmount) : 0;

  // ESI: employee-side percentage of gross, only when gross is at/below the configured threshold.
  const esi_deduction = gross <= esiThreshold ? round2(gross * (esiEmployeePercent / 100)) : 0;

  // TDS: per-employee mode overrides company when set to fixed/none
  let tds_deduction = 0;
  if (empTdsMode === 'none' || empTdsMode === 'exempt') {
    tds_deduction = 0;
  } else if (empTdsMode === 'fixed' || empTdsMode === 'manual') {
    tds_deduction = round2(Number(salary.tds_fixed ?? salary.tdsFixed ?? salary.tds ?? 0));
  } else if (salary.tds != null && Number(salary.tds) > 0 && companyTdsMode === 'manual') {
    tds_deduction = round2(Number(salary.tds));
  } else if (tdsPercent > 0) {
    // tdsPercent is stored as whole number (e.g. 8) from FE
    tds_deduction = round2(gross * (tdsPercent / 100));
  }

  const vars = {
    basic_salary: basic,
    hra,
    da,
    special,
    gross_salary: gross,
    unpaid_leave_days,
    working_days: weekdayCount,
    lop_deduction,
    pf_deduction,
    professional_tax,
    tds_deduction,
    esi_deduction,
  };

  const deductions = [];
  if (lop_deduction > 0) deductions.push({ name: 'LOP', amount: lop_deduction });
  if (pf_deduction > 0) deductions.push({ name: 'PF', amount: pf_deduction });
  if (professional_tax > 0) deductions.push({ name: 'Professional Tax', amount: professional_tax });
  if (esi_deduction > 0) deductions.push({ name: 'ESI', amount: esi_deduction });
  if (tds_deduction > 0) deductions.push({ name: 'TDS', amount: tds_deduction });
  for (const d of pendingCustomDeductions) deductions.push(d);

  // Legacy / DB payroll_components (if configured)
  const { data: components, error: compErr } = await supabaseAdmin
    .from('payroll_components')
    .select('*')
    .eq('is_active', true)
    .eq('company_id', companyId)
    .order('display_order', { ascending: true });
  if (compErr) throw new BadRequestError(compErr.message);

  const skipNames = new Set([
    'basic', 'hra', 'da', 'special', 'special allowance', 'lop', 'pf',
    'professional tax', 'pt', 'tds', 'esi', 'esic',
  ]);
  for (const c of components || []) {
    const name = String(c.name || '').trim().toLowerCase();
    if (skipNames.has(name)) continue;
    // Skip if already added via custom options
    if (customOptions.some((o) => String(o.name || '').trim().toLowerCase() === name)) continue;

    const amount = computeRule(vars, c);
    if (amount <= 0) continue;
    if (c.type === 'EARNING') {
      earnings.push({ name: c.name, amount });
      gross = round2(gross + amount);
      vars.gross_salary = gross;
    } else {
      deductions.push({ name: c.name, amount });
    }
    if (c.output_field) vars[String(c.output_field)] = amount;
  }

  const gross_final = round2(gross);
  const total_deductions = round2(deductions.reduce((s, d) => s + Number(d.amount || 0), 0));
  const net_pay = round2(Math.max(0, gross_final - total_deductions));

  const breakdown_json = {
    earnings,
    deductions,
    totals: { gross_salary: gross_final, total_deductions, net_pay },
    config: {
      working_days: weekdayCount,
      working_days_setting: workingDaysSetting,
      pf_rate: empPfRate,
      company_pf_rate: pfRate,
      professional_tax: professional_tax,
      pt_state: ptState || null,
      esi_deduction,
      esi_threshold: esiThreshold,
      tds_percent: tdsPercent,
      unpaid_leave_days,
      absent,
      half_day: halfDay,
      pf_applicable: pfApplicable,
      pt_applicable: ptApplicable,
      tds_mode: empTdsMode,
    },
  };

  return {
    basic_salary: basic,
    hra,
    gross_salary: gross_final,
    unpaid_leave_days,
    lop_deduction,
    pf_deduction,
    professional_tax,
    esi_deduction,
    net_salary: net_pay,
    breakdown_json,
  };
};

const computeRule = (vars, component) => {
  if (component.is_fixed) return round2(component.fixed_amount || 0);

  const target = String(component.target_field || '');
  const op = String(component.operator || '');
  const operand = component.operand_field ? Number(vars[String(component.operand_field)] || 0) : Number(component.operand_value || 0);
  const base = Number(vars[target] || 0);

  if (op === '%') return round2(base * (operand / 100));
  if (op === '*') return round2(base * operand);
  if (op === '+') return round2(base + operand);
  if (op === '-') return round2(base - operand);
  if (op === '/') return operand === 0 ? 0 : round2(base / operand);

  return round2(base);
};

const fetchMonthReimbursements = async (employeeId, month, year) => {
  if (!employeeId || !month || !year) return [];
  const start = moment.tz({ year, month: month - 1, day: 1 }, TIMEZONE).startOf('month').format('YYYY-MM-DD');
  const end = moment.tz({ year, month: month - 1, day: 1 }, TIMEZONE).endOf('month').format('YYYY-MM-DD');
  const { data } = await supabaseAdmin
    .from('reimbursements')
    .select('id, reimbursement_type, amount, description, expense_date, status')
    .eq('employee_id', employeeId)
    .eq('status', 'approved')
    .gte('expense_date', start)
    .lte('expense_date', end);
  return (data || []).map((r) => ({
    name: r.description
      || String(r.reimbursement_type || 'Reimbursement').replace(/_/g, ' '),
    amount: round2(Number(r.amount || 0)),
  }));
};

const enrichPayslipBreakdown = async (employee, calc, month, year) => {
  const salary = employee?.salary_details || {};
  const bank = employee?.bank_details || {};
  const monthly = ['basic', 'hra', 'da', 'special', 'transport', 'medical']
    .reduce((s, k) => s + Number(salary[k] || 0), 0);
  const ctc = round2(Number(salary.ctc || salary.annual_ctc || salary.annualCtc || monthly * 12));
  const cfg = calc.breakdown_json?.config || {};
  const working = Number(cfg.working_days || 0);
  const lop = Number(calc.unpaid_leave_days || cfg.unpaid_leave_days || 0);
  const paidDays = round2(Math.max(0, working - lop));
  const reimbursements = await fetchMonthReimbursements(employee.id, month, year);
  const totalReimb = round2(reimbursements.reduce((s, r) => s + Number(r.amount || 0), 0));
  const account = bank.account_number || bank.accountNumber || bank.account || '';
  const netPay = Number(calc.breakdown_json?.totals?.net_pay ?? calc.net_salary ?? 0);

  calc.breakdown_json = {
    ...calc.breakdown_json,
    reimbursements,
    totals: {
      ...(calc.breakdown_json?.totals || {}),
      total_reimbursements: totalReimb,
      net_payable: round2(netPay + totalReimb),
    },
    meta: {
      employee_name: `${employee.first_name || ''} ${employee.last_name || ''}`.trim(),
      designation: employee.designation || '',
      date_of_joining: employee.date_of_joining || '',
      pay_method: account ? 'Net Banking' : '—',
      account_number: account,
      ctc,
      paid_days: paidDays,
      lop_days: lop,
      working_days: working,
    },
  };
  return calc;
};

/**
 * Dynamic payroll engine
 * - Rules are managed by Admin in Settings → Salary Structure (payroll_components table)
 * - Generated breakdown is persisted in payroll.breakdown_json for frontend + PDF rendering
 */
const calculateDynamicPayslip = async (employee, attendanceSummary) => {
  const { getCompanyId, DEFAULT_COMPANY_ID } = require('../utils/tenant');
  const companyId = getCompanyId(employee) || DEFAULT_COMPANY_ID;
  const salary = employee.salary_details || {};

  const presentDays = (attendanceSummary?.present || 0) + (attendanceSummary?.halfDay || 0) * 0.5;
  const unpaid_leave_days = Math.max(0, WORKING_DAYS_PER_MONTH - presentDays);

  const vars = {
    // base variables from employee profile
    employee_basic: Number(salary.basic || 0),
    employee_hra: Number(salary.hra || 0),
    unpaid_leave_days,
    working_days: WORKING_DAYS_PER_MONTH,
  };

  // Defensive company filter — this path has no live caller today, but without
  // it a future caller would leak every tenant's salary-structure components.
  const { data: components, error } = await supabaseAdmin
    .from('payroll_components')
    .select('*')
    .eq('is_active', true)
    .eq('company_id', companyId)
    .order('display_order', { ascending: true });
  if (error) throw new BadRequestError(error.message);

  if (!components || !components.length) {
    throw new BadRequestError('No payroll components configured. Please add salary structure in Settings.');
  }

  const earnings = [];
  const deductions = [];

  // Admin defines everything. We compute in display_order sequence and allow chaining via output_field.
  for (const c of components || []) {
    const amount = computeRule(vars, c);
    const row = { name: c.name, amount, display_order: c.display_order, output_field: c.output_field || null };

    if (c.type === 'EARNING') earnings.push(row);
    else deductions.push(row);

    // Allow explicit chaining: store output in vars for downstream rules
    if (c.output_field) {
      vars[String(c.output_field)] = amount;
    }

    // Also maintain gross salary automatically from earnings
    if (c.type === 'EARNING') {
      vars.gross_salary = Number(vars.gross_salary || 0) + amount;
    }
  }

  vars.gross_salary = Number(vars.gross_salary || 0);

  const gross_salary = round2(vars.gross_salary);
  const total_deductions = round2(deductions.reduce((s, d) => s + Number(d.amount || 0), 0));
  const net_pay = round2(Math.max(0, gross_salary - total_deductions));

  const breakdown_json = {
    earnings: earnings.map((e) => ({ name: e.name, amount: e.amount })),
    deductions: deductions.map((d) => ({ name: d.name, amount: d.amount })),
    totals: { gross_salary, total_deductions, net_pay },
  };

  return {
    basic_salary: round2(vars.basic_salary ?? vars.employee_basic ?? 0),
    hra: round2(vars.hra ?? vars.employee_hra ?? 0),
    gross_salary,
    unpaid_leave_days: round2(unpaid_leave_days),
    total_deductions,
    net_salary: net_pay,
    breakdown_json,
  };
};

const mapPayslipRow = (row) => ({
  id: row.id,
  payroll_month_id: row.payroll_month_id,
  user_id: row.employee_id,
  employee_id: row.employee_id,
  month: row.month,
  year: row.year,
  basic_salary: row.basic_salary,
  hra: row.hra,
  gross_salary: row.gross_salary,
  unpaid_leave_days: row.unpaid_leave_days,
  lop_deduction: row.lop_deduction,
  pf_deduction: row.pf_deduction,
  pt_deduction: row.professional_tax ?? row.pt_deduction,
  net_pay: row.net_salary,
  net_salary: row.net_salary,
  status: row.payslip_status || PAYSLIP_STATUS.DRAFT,
  payslip_url: row.payslip_url,
  breakdown_json: row.breakdown_json,
  payment_status: row.payment_status,
  employee: row.employee,
  first_name: row.employee?.first_name,
  last_name: row.employee?.last_name,
  employee_code: row.employee?.employee_code,
});

const initializeMonth = async (month, year, createdBy, companyId = null) => {
  const { getCompanyId, DEFAULT_COMPANY_ID } = require('../utils/tenant');
  const cid = companyId || DEFAULT_COMPANY_ID;

  let q = supabaseAdmin
    .from('payroll_months')
    .select('*')
    .eq('month', month)
    .eq('year', year)
    .eq('company_id', cid);
  const { data: existing } = await q.maybeSingle();

  // Contract: treat initialize as idempotent
  if (existing) return existing;

  const { data, error } = await supabaseAdmin
    .from('payroll_months')
    .insert({
      month,
      year,
      status: MONTH_STATUS.PENDING,
      created_by: createdBy,
      company_id: cid,
    })
    .select()
    .single();

  if (error) throw new BadRequestError(error.message);
  return data;
};

const getMonthStatus = async (month, year, companyId = null) => {
  const { DEFAULT_COMPANY_ID } = require('../utils/tenant');
  const cid = companyId || DEFAULT_COMPANY_ID;
  const { data, error } = await supabaseAdmin
    .from('payroll_months')
    .select('*')
    .eq('month', month)
    .eq('year', year)
    .eq('company_id', cid)
    .maybeSingle();

  if (error) throw new BadRequestError(error.message);
  return data || null;
};

const generateDraftPayslip = async (payrollMonthId, userId, companyId = null) => {
  const { data: payrollMonth } = await supabaseAdmin
    .from('payroll_months')
    .select('*')
    .eq('id', payrollMonthId)
    .single();

  if (!payrollMonth) throw new NotFoundError('Payroll month not found');
  // A client-supplied payroll_month_id must belong to the caller's own
  // company — otherwise an HR/Admin who knows/guesses another tenant's
  // payroll_months UUID could attach their own employee's payslip to it.
  if (companyId && payrollMonth.company_id !== companyId) {
    throw new NotFoundError('Payroll month not found');
  }
  // Allow generating slips for newly added employees even after a month was auto-closed
  if (payrollMonth.status === MONTH_STATUS.COMPLETED) {
    await supabaseAdmin
      .from('payroll_months')
      .update({ status: MONTH_STATUS.PENDING })
      .eq('id', payrollMonthId);
    payrollMonth.status = MONTH_STATUS.PENDING;
  }

  const { data: employee } = await supabaseAdmin
    .from('employees')
    .select('*')
    .eq('id', userId)
    .eq('is_active', true)
    .single();

  if (!employee) throw new NotFoundError('Employee not found');

  const { data: existing } = await supabaseAdmin
    .from('payroll')
    .select('id, payslip_status')
    .eq('employee_id', userId)
    .eq('month', payrollMonth.month)
    .eq('year', payrollMonth.year)
    .maybeSingle();

  // If a draft already exists, recalculate and update it (so changes in Settings/components apply).
  if (existing?.id) {
    const existingStatus = String(existing.payslip_status || '').toUpperCase();
    if (existingStatus === PAYSLIP_STATUS.PUBLISHED) {
      throw new ConflictError('Payslip already published for this employee and month');
    }

    const { summary } = await attendanceService.getMonthlySummary(userId, payrollMonth.month, payrollMonth.year);
    const calc = await enrichPayslipBreakdown(
      employee,
      await calculateContractPayslip(employee, summary, payrollMonth.month),
      payrollMonth.month,
      payrollMonth.year,
    );

    const { data: updated, error: updErr } = await supabaseAdmin
      .from('payroll')
      .update({
        ...calc,
        payslip_status: PAYSLIP_STATUS.DRAFT,
        payment_status: 'pending',
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .select(`*, employee:employee_id(${PAYSLIP_EMPLOYEE_SELECT})`)
      .single();
    if (updErr) throw new BadRequestError(updErr.message);
    return mapPayslipRow(updated);
  }

  const { summary } = await attendanceService.getMonthlySummary(userId, payrollMonth.month, payrollMonth.year);
  const calc = await enrichPayslipBreakdown(
    employee,
    await calculateContractPayslip(employee, summary, payrollMonth.month),
    payrollMonth.month,
    payrollMonth.year,
  );

  const { data: payslip, error } = await supabaseAdmin
    .from('payroll')
    .insert({
      employee_id: userId,
      payroll_month_id: payrollMonthId,
      company_id: payrollMonth.company_id,
      month: payrollMonth.month,
      year: payrollMonth.year,
      ...calc,
      payslip_status: PAYSLIP_STATUS.DRAFT,
      payment_status: 'pending',
    })
    .select('*, employee:employee_id(id, first_name, last_name, employee_code, email, company_id, address)')
    .single();

  if (error) throw new BadRequestError(error.message);
  return mapPayslipRow(payslip);
};

const generateAllDraftPayslips = async (payrollMonthId, companyId = null) => {
  // No caller in this codebase ever legitimately omits companyId for a
  // payroll operation — fail closed instead of silently generating payslips
  // for every active employee on the entire platform.
  if (!companyId) throw new BadRequestError('companyId is required to generate payslips');

  const tenantService = require('./tenant.service');
  const ids = await tenantService.getCompanyEmployeeIds(companyId);
  const employees = ids.map((id) => ({ id }));

  const results = [];
  for (const emp of employees) {
    try {
      const payslip = await generateDraftPayslip(payrollMonthId, emp.id, companyId);
      results.push({ user_id: emp.id, status: 'generated', payslip });
    } catch (err) {
      results.push({ user_id: emp.id, status: 'skipped', reason: err.message });
    }
  }
  return results;
};

const generatePayslipPdf = (employee, payslip, payrollMonth, companyId) =>
  buildPayslipPdfBuffer(employee, payslip, payrollMonth, { companyId });

const maybeCloseMonth = async (payrollMonthId) => {
  const { data: payrollMonth } = await supabaseAdmin
    .from('payroll_months')
    .select('*')
    .eq('id', payrollMonthId)
    .single();

  if (!payrollMonth) return;

  const { count: employeeCount } = await supabaseAdmin
    .from('employees')
    .select('id', { count: 'exact', head: true })
    .eq('is_active', true)
    .eq('company_id', payrollMonth.company_id);

  const { count: publishedCount } = await supabaseAdmin
    .from('payroll')
    .select('id', { count: 'exact', head: true })
    .eq('payroll_month_id', payrollMonthId)
    .eq('payslip_status', PAYSLIP_STATUS.PUBLISHED);

  if (employeeCount && publishedCount >= employeeCount) {
    await supabaseAdmin
      .from('payroll_months')
      .update({ status: MONTH_STATUS.COMPLETED })
      .eq('id', payrollMonthId);
  }
};

const publishPayslip = async (payslipId, publisher) => {
  const { data: payslip } = await supabaseAdmin
    .from('payroll')
    .select(`*, employee:employee_id(${PAYSLIP_EMPLOYEE_SELECT})`)
    .eq('id', payslipId)
    .single();

  if (!payslip) throw new NotFoundError('Payslip not found');
  if (require('../utils/tenant').getCompanyId(payslip.employee) !== publisher.company_id) {
    throw new NotFoundError('Payslip not found');
  }
  if (payslip.payslip_status === PAYSLIP_STATUS.PUBLISHED) {
    throw new BadRequestError('Payslip is already published');
  }

  // Item 2: bank_details is optional at employee creation, so a draft
  // payslip can exist and be reviewed with it still missing — but
  // publishing is the point this payslip becomes final/actionable for
  // real disbursement, so it's the right gate to fail loudly here rather
  // than silently publishing a payslip with a blank account number.
  const bank = payslip.employee?.bank_details || {};
  const hasBankDetails = Boolean(
    (bank.account_number || bank.accountNumber || bank.account)
    && (bank.ifsc || bank.ifscCode)
    && (bank.bank_name || bank.bankName),
  );
  if (!hasBankDetails) {
    const name = `${payslip.employee?.first_name || ''} ${payslip.employee?.last_name || ''}`.trim() || 'this employee';
    throw new BadRequestError(`Cannot publish payslip for ${name} — bank details are missing. Ask them to add bank details, or add them via Employee → Edit.`);
  }

  // Prefer explicit link; fall back to month/year so older/seeded slips still publish
  let payrollMonth = null;
  if (payslip.payroll_month_id) {
    const { data } = await supabaseAdmin
      .from('payroll_months')
      .select('*')
      .eq('id', payslip.payroll_month_id)
      .maybeSingle();
    payrollMonth = data;
  }
  if (!payrollMonth) {
    const { data } = await supabaseAdmin
      .from('payroll_months')
      .select('*')
      .eq('month', payslip.month)
      .eq('year', payslip.year)
      .eq('company_id', publisher.company_id)
      .maybeSingle();
    payrollMonth = data;
  }
  // Auto-create the month row if still missing (test/seed gaps)
  if (!payrollMonth) {
    const { data, error: monthErr } = await supabaseAdmin
      .from('payroll_months')
      .insert({
        month: payslip.month,
        year: payslip.year,
        status: MONTH_STATUS.PENDING,
        created_by: publisher.id,
        company_id: publisher.company_id,
      })
      .select('*')
      .single();
    if (monthErr) throw new BadRequestError(monthErr.message);
    payrollMonth = data;
  }
  // Relink payslip so future publishes/downloads work
  if (payslip.payroll_month_id !== payrollMonth.id) {
    await supabaseAdmin
      .from('payroll')
      .update({ payroll_month_id: payrollMonth.id })
      .eq('id', payslipId);
    payslip.payroll_month_id = payrollMonth.id;
  }

  const pdfBuffer = await generatePayslipPdf(payslip.employee, payslip, payrollMonth, publisher.company_id);
  const { path } = await uploadPayslip(pdfBuffer, payslip.employee_id, payslip.month, payslip.year);
  // Audit finding N-09: was a 1-year TTL — this URL is a bearer credential
  // for a salary PDF with no further auth check once issued, and it's
  // returned as-is in the payroll list/detail API response (payslip_url).
  // The actual "download payslip" flow (downloadPayslip below) never uses
  // this stored URL at all — it regenerates the PDF fresh from live data
  // on every request — so this stored copy is only ever a background-
  // refreshed deep-link value, not something that needs a long lifetime.
  const signedUrl = await getSignedUrl(STORAGE_BUCKETS.payslips, path, 60 * 60);

  // published_by/published_at are the authoritative, queryable audit record
  // for who published this payslip — set from the authenticated `publisher`,
  // never from a request body. logger.info below stays as a secondary trace.
  const publishPatch = {
    payslip_status: PAYSLIP_STATUS.PUBLISHED,
    payslip_url: signedUrl,
    payment_status: 'processed',
    published_by: publisher.id,
    published_at: new Date().toISOString(),
  };

  // Audit finding N-06: .eq('payslip_status', DRAFT) on the write itself
  // closes the TOCTOU window between the read-time check above (line 705)
  // and this write — a lost race updates zero rows instead of double-
  // publishing (duplicate notification, duplicate month-close check).
  let { data: updated, error } = await supabaseAdmin
    .from('payroll')
    .update(publishPatch)
    .eq('id', payslipId)
    .eq('payslip_status', PAYSLIP_STATUS.DRAFT)
    .select('*, employee:employee_id(id, first_name, last_name, employee_code)')
    .maybeSingle();

  if (error && /column .*published_(by|at).* does not exist/i.test(error.message || '')) {
    // Migration 20260829_payroll_publish_audit.sql not applied yet in this
    // environment — fall back rather than blocking every publish on it.
    const { published_by, published_at, ...withoutAuditCols } = publishPatch;
    ({ data: updated, error } = await supabaseAdmin
      .from('payroll')
      .update(withoutAuditCols)
      .eq('id', payslipId)
      .eq('payslip_status', PAYSLIP_STATUS.DRAFT)
      .select('*, employee:employee_id(id, first_name, last_name, employee_code)')
      .maybeSingle());
  }

  if (error) throw new BadRequestError(error.message);
  if (!updated) throw new ConflictError('Payslip is already published');

  await maybeCloseMonth(payslip.payroll_month_id);
  logger.info('Payslip published', { payslipId, publisherId: publisher.id });

  // Notify employee
  await notificationService.createNotification({
    user_id: payslip.employee_id,
    type: 'PAYROLL',
    title: 'Payslip published',
    message: `Your payslip for ${moment.tz({ year: payslip.year, month: payslip.month - 1 }, TIMEZONE).format('MMMM YYYY')} is now available.`,
    link: '/payroll/me',
    meta: { payslip_id: payslipId, month: payslip.month, year: payslip.year },
  });

  if (payslip.employee?.email) {
    // Section G1: the shared suppression gate — payslip email is a
    // Payroll-linked email, so it's absolutely blocked while Payroll
    // visibility is off for this company, independent of data_collection_mode.
    // The payslip record itself is still published/calculated normally either way.
    require('./emailSuppression.service').guardedSend(publisher.company_id, 'payroll', 'payslip_published', () =>
      emailService.payslipEmail(payslip.employee, payslip)).catch((e) =>
      logger.warn('payslipEmail failed', { error: e.message }));
  }

  require('./webhook.service').dispatchWebhookEvent(publisher.company_id, 'payroll.payslip_published', {
    payslipId: updated.id, employeeId: payslip.employee_id, month: payslip.month, year: payslip.year,
  });

  return {
    id: updated.id,
    status: PAYSLIP_STATUS.PUBLISHED,
    payslip_url: updated.payslip_url,
    ...mapPayslipRow(updated),
  };
};

const PAYROLL_LIST_SELECT = '*, employee:employee_id(id, first_name, last_name, employee_code, email, company_id, address)';

const listPayslips = async ({
  month, year, user, role, mine = false, companyId = null, pageQuery = {},
}) => {
  // Personal "My Payslips" (or employee role): only own published slips —
  // inherently bounded (one row per month, per employee), no pagination needed.
  const personalOnly = mine || role === 'employee' || role === 'manager';
  if (personalOnly) {
    const { data, error } = await supabaseAdmin
      .from('payroll')
      .select(PAYROLL_LIST_SELECT)
      .eq('month', month)
      .eq('year', year)
      .eq('employee_id', user.id)
      .eq('payslip_status', PAYSLIP_STATUS.PUBLISHED)
      .order('created_at', { ascending: false });
    if (error) throw new BadRequestError(error.message);
    return { data: (data || []).map(mapPayslipRow), meta: null };
  }

  // hr / admin without mine=true: company-wide list (Run Payroll / Salary
  // Sheet) — this is the branch that scales with headcount (audit M-14).
  let query = supabaseAdmin
    .from('payroll')
    .select(PAYROLL_LIST_SELECT, { count: 'exact' })
    .eq('month', month)
    .eq('year', year);

  if (companyId) {
    const tenantService = require('./tenant.service');
    const ids = await tenantService.getCompanyEmployeeIds(companyId);
    query = query.in(
      'employee_id',
      ids.length ? ids : ['00000000-0000-0000-0000-000000000000']
    );
  }

  const page = Math.max(1, parseInt(pageQuery.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(pageQuery.limit, 10) || 50));
  const offset = (page - 1) * limit;

  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw new BadRequestError(error.message);
  return { data: (data || []).map(mapPayslipRow), meta: buildMeta(page, limit, count || 0) };
};

/**
 * Re-apply live payroll settings to existing slips (draft + published).
 * Default: current calendar month + any PENDING payroll months.
 * Published slips keep PUBLISHED status; PDF is regenerated when present.
 */
const recalculatePayslipsFromSettings = async ({
  month, year, employeeId, companyId,
} = {}) => {
  const now = moment.tz(TIMEZONE);
  const focusMonth = Number(month) || now.month() + 1;
  const focusYear = Number(year) || now.year();

  const targets = new Map();
  targets.set(`${focusYear}-${focusMonth}`, { month: focusMonth, year: focusYear });

  let pendingQuery = supabaseAdmin
    .from('payroll_months')
    .select('id, month, year, status, company_id')
    .eq('status', MONTH_STATUS.PENDING);
  if (companyId) pendingQuery = pendingQuery.eq('company_id', companyId);
  const { data: pendingMonths } = await pendingQuery;

  for (const pm of pendingMonths || []) {
    targets.set(`${pm.year}-${pm.month}`, { month: pm.month, year: pm.year, id: pm.id });
  }

  let updated = 0;
  const details = [];
  let companyEmployeeIds = null;
  if (companyId) {
    companyEmployeeIds = await require('./tenant.service').getCompanyEmployeeIds(companyId);
  }

  for (const t of targets.values()) {
    let query = supabaseAdmin
      .from('payroll')
      .select(`*, employee:employee_id(${PAYSLIP_EMPLOYEE_SELECT})`)
      .eq('month', t.month)
      .eq('year', t.year);
    if (employeeId) query = query.eq('employee_id', employeeId);
    else if (companyEmployeeIds) {
      query = query.in(
        'employee_id',
        companyEmployeeIds.length
          ? companyEmployeeIds
          : ['00000000-0000-0000-0000-000000000000']
      );
    }

    const { data: slips, error } = await query;

    if (error) throw new BadRequestError(error.message);

    for (const row of slips || []) {
      try {
        const employee = row.employee;
        if (!employee) {
          details.push({ id: row.id, status: 'skipped', reason: 'Employee missing' });
          continue;
        }

        const { summary } = await attendanceService.getMonthlySummary(
          row.employee_id,
          row.month,
          row.year
        );
        const calc = await enrichPayslipBreakdown(
          employee,
          await calculateContractPayslip(employee, summary, row.month),
          row.month,
          row.year,
        );
        const wasPublished = String(row.payslip_status || '').toUpperCase() === PAYSLIP_STATUS.PUBLISHED;

        const patch = {
          ...calc,
          updated_at: new Date().toISOString(),
        };

        // Numbers only here — downloadPayslip always rebuilds PDF from live row data.

        const { error: updErr } = await supabaseAdmin
          .from('payroll')
          .update(patch)
          .eq('id', row.id);

        if (updErr) throw new BadRequestError(updErr.message);

        updated += 1;
        details.push({
          id: row.id,
          employee_id: row.employee_id,
          month: row.month,
          year: row.year,
          status: wasPublished ? 'updated_published' : 'updated_draft',
          net_salary: calc.net_salary,
        });
      } catch (err) {
        details.push({ id: row.id, status: 'error', reason: err.message });
      }
    }
  }

  logger.info('Payslips recalculated from settings', { updated, focusMonth, focusYear });
  return { updated, month: focusMonth, year: focusYear, details };
};

const downloadPayslip = async (payslipId, user) => {
  const { data: payslip } = await supabaseAdmin
    .from('payroll')
    .select(`*, employee:employee_id(${PAYSLIP_EMPLOYEE_SELECT})`)
    .eq('id', payslipId)
    .single();

  if (!payslip) throw new NotFoundError('Payslip not found');

  const isOwn = payslip.employee_id === user.id;
  const isHrAdmin = ['hr', 'admin'].includes(user.role);
  if (require('../utils/tenant').getCompanyId(payslip.employee) !== user.company_id) {
    throw new NotFoundError('Payslip not found');
  }
  if (!isOwn && !isHrAdmin) throw new ForbiddenError('Not authorized');

  if (String(payslip.payslip_status || '').toUpperCase() === PAYSLIP_STATUS.DRAFT) {
    throw new ForbiddenError('Payslip is not published yet');
  }

  let payrollMonth = null;
  if (payslip.payroll_month_id) {
    const { data } = await supabaseAdmin
      .from('payroll_months')
      .select('*')
      .eq('id', payslip.payroll_month_id)
      .maybeSingle();
    payrollMonth = data;
  }
  if (!payrollMonth) {
    const { data } = await supabaseAdmin
      .from('payroll_months')
      .select('*')
      .eq('month', payslip.month)
      .eq('year', payslip.year)
      .maybeSingle();
    payrollMonth = data;
  }

  const pdfBuffer = await generatePayslipPdf(
    payslip.employee,
    payslip,
    payrollMonth || { month: payslip.month, year: payslip.year },
    user.company_id,
  );

  // Refresh stored copy in background so email/deep links stay current.
  // Audit finding N-09: shortened from a 1-year TTL — see the matching
  // comment in publishPayslip above.
  uploadPayslip(pdfBuffer, payslip.employee_id, payslip.month, payslip.year)
    .then(async ({ path }) => {
      const signedUrl = await getSignedUrl(STORAGE_BUCKETS.payslips, path, 60 * 60);
      await supabaseAdmin
        .from('payroll')
        .update({ payslip_url: signedUrl })
        .eq('id', payslipId);
    })
    .catch((err) => logger.warn('Payslip storage refresh failed', { payslipId, err: err.message }));

  const filename = `payslip-${payslip.year}-${String(payslip.month).padStart(2, '0')}.pdf`;
  return { buffer: pdfBuffer, filename, payslip: mapPayslipRow(payslip) };
};

/**
 * Auto-process for one company: initialize current month + generate draft payslips.
 * Idempotent per calendar month via payroll_config.last_auto_payroll_ym.
 */
const autoRunPayrollForCompany = async (companyId, { force = false } = {}) => {
  const settingsService = require('./settings.service');
  const tenantService = require('./tenant.service');

  const now = moment.tz(TIMEZONE);
  const month = now.month() + 1;
  const year = now.year();
  const ym = `${year}-${String(month).padStart(2, '0')}`;

  const payrollConfig = (await settingsService.getSetting('payroll_config', {}, companyId)) || {};
  const autoProcess = Boolean(
    payrollConfig.auto_process ?? payrollConfig.autoProcess ?? false,
  );
  if (!autoProcess && !force) {
    return { companyId, skipped: true, reason: 'auto_process_off' };
  }

  const runDate = Math.min(
    28,
    Math.max(1, Number(payrollConfig.run_date ?? payrollConfig.runDate ?? 25) || 25),
  );
  if (!force && now.date() !== runDate) {
    return { companyId, skipped: true, reason: 'not_run_date', runDate, today: now.date() };
  }

  const lastYm = payrollConfig.last_auto_payroll_ym || payrollConfig.lastAutoPayrollYm;
  if (!force && lastYm === ym) {
    return { companyId, skipped: true, reason: 'already_ran', ym };
  }

  const adminIds = await tenantService.getCompanyHrAdminIds(companyId);
  const createdBy = adminIds[0] || null;

  const payrollMonth = await initializeMonth(month, year, createdBy, companyId);
  const results = await generateAllDraftPayslips(payrollMonth.id, companyId);
  const generated = results.filter((r) => r.status === 'generated').length;
  const skippedEmployees = results.filter((r) => r.status === 'skipped').length;

  await settingsService.setSetting(
    'payroll_config',
    {
      ...payrollConfig,
      auto_process: autoProcess || Boolean(payrollConfig.auto_process ?? payrollConfig.autoProcess),
      run_date: runDate,
      last_auto_payroll_ym: ym,
      last_auto_payroll_at: now.toISOString(),
    },
    createdBy,
    companyId,
  );

  return {
    companyId,
    month,
    year,
    payrollMonthId: payrollMonth.id,
    generated,
    skippedEmployees,
    skipped: false,
  };
};

/** Scan all active companies and auto-run payroll when due. */
const processAutoPayroll = async (reason = 'cron') => {
  const tenantService = require('./tenant.service');
  const companies = await tenantService.listActiveCompanies();
  const summary = { reason, companies: companies.length, ran: 0, skipped: 0, errors: 0, details: [] };

  for (const company of companies) {
    try {
      // Section G2: data_collection_mode='stop' for payroll — a clean,
      // total skip, no calculation and nothing written, checked before
      // autoRunPayrollForCompany does any work at all. Distinct from
      // visibility (which only ever gates outward emails/display) — this
      // is the one place a company can be excluded from processing itself.
      const mode = await require('./featureOverride.service').getDataCollectionMode(company.id, 'payroll');
      if (mode === 'stop') {
        logger.info('[AutoPayroll] Skipped — data_collection_mode is stop', { companyId: company.id, name: company.name });
        summary.skipped += 1;
        summary.details.push({ companyId: company.id, name: company.name, skipped: true, reason: 'data_collection_stopped' });
        continue;
      }

      const result = await autoRunPayrollForCompany(company.id);
      summary.details.push({ name: company.name, ...result });
      if (result.skipped) summary.skipped += 1;
      else summary.ran += 1;
    } catch (err) {
      summary.errors += 1;
      summary.details.push({ companyId: company.id, name: company.name, error: err.message });
      logger.error('Auto payroll failed for company', {
        companyId: company.id,
        name: company.name,
        error: err.message,
      });
    }
  }

  return summary;
};

module.exports = {
  calculateDynamicPayslip,
  calculateContractPayslip,
  initializeMonth,
  getMonthStatus,
  generateDraftPayslip,
  generateAllDraftPayslips,
  publishPayslip,
  listPayslips,
  downloadPayslip,
  recalculatePayslipsFromSettings,
  mapPayslipRow,
  autoRunPayrollForCompany,
  processAutoPayroll,
};
