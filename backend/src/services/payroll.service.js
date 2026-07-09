const PDFDocument = require('pdfkit');
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

const WORKING_DAYS_PER_MONTH = 23;
const MONTH_STATUS = { PENDING: 'PENDING', COMPLETED: 'COMPLETED' };
const PAYSLIP_STATUS = { DRAFT: 'DRAFT', PUBLISHED: 'PUBLISHED' };
const COMPANY_NAME = process.env.COMPANY_NAME || 'HRMS Company Pvt Ltd';

// Contract v1 math engine (fixed rules)
const calculateContractPayslip = async (employee, attendanceSummary) => {
  const workingDays = Math.max(1, await settingsService.getNumber('payroll_working_days', WORKING_DAYS_PER_MONTH));
  const pfRate = Math.max(0, await settingsService.getNumber('payroll_pf_rate', 0.12));
  const ptAmount = Math.max(0, await settingsService.getNumber('payroll_professional_tax', 200));

  const salary = employee.salary_details || {};
  const basic = round2(Number(salary.basic || 0));
  const hra = round2(Number(salary.hra || 0));
  const gross = round2(basic + hra);

  const presentDays = (attendanceSummary?.present || 0) + (attendanceSummary?.halfDay || 0) * 0.5;
  const unpaid_leave_days = round2(Math.max(0, workingDays - presentDays));

  const lop_deduction = round2((gross / workingDays) * unpaid_leave_days);
  const pf_deduction = round2(basic * pfRate);
  const professional_tax = round2(ptAmount);

  // Optional: Admin-configurable extra payroll components (earnings/deductions)
  // This lets Admin add new %/fixed items without backend changes.
  const vars = {
    basic_salary: basic,
    hra,
    gross_salary: gross,
    unpaid_leave_days,
    working_days: workingDays,
    lop_deduction,
    pf_deduction,
    professional_tax,
  };

  const earnings = [
    { name: 'Basic', amount: basic },
    { name: 'HRA', amount: hra },
  ];
  const deductions = [
    { name: 'LOP', amount: lop_deduction },
    { name: 'PF', amount: pf_deduction },
    { name: 'Professional Tax', amount: professional_tax },
  ];

  const { data: components, error: compErr } = await supabaseAdmin
    .from('payroll_components')
    .select('*')
    .eq('is_active', true)
    .order('display_order', { ascending: true });
  if (compErr) throw new BadRequestError(compErr.message);

  for (const c of components || []) {
    // Avoid duplicating the base items if Admin creates them by mistake.
    const name = String(c.name || '').trim().toLowerCase();
    if (['basic', 'hra', 'lop', 'pf', 'professional tax', 'pt'].includes(name)) continue;

    const amount = computeRule(vars, c);
    if (c.type === 'EARNING') {
      earnings.push({ name: c.name, amount });
      vars.gross_salary = round2(Number(vars.gross_salary || 0) + amount);
    } else {
      deductions.push({ name: c.name, amount });
    }
    if (c.output_field) vars[String(c.output_field)] = amount;
  }

  const gross_final = round2(Number(vars.gross_salary || 0));
  const total_deductions = round2(deductions.reduce((s, d) => s + Number(d.amount || 0), 0));
  const net_pay = round2(Math.max(0, gross_final - total_deductions));

  const breakdown_json = {
    earnings,
    deductions,
    totals: { gross_salary: gross_final, total_deductions, net_pay },
    config: { working_days: workingDays, pf_rate: pfRate, professional_tax: ptAmount },
  };

  return {
    basic_salary: basic,
    hra,
    gross_salary: gross_final,
    unpaid_leave_days,
    lop_deduction,
    pf_deduction,
    professional_tax,
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

/**
 * Dynamic payroll engine
 * - Rules are managed by Admin in Settings → Salary Structure (payroll_components table)
 * - Generated breakdown is persisted in payroll.breakdown_json for frontend + PDF rendering
 */
const calculateDynamicPayslip = async (employee, attendanceSummary) => {
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

  const { data: components, error } = await supabaseAdmin
    .from('payroll_components')
    .select('*')
    .eq('is_active', true)
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

const round2 = (n) => Math.round(Number(n) * 100) / 100;

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

const initializeMonth = async (month, year, createdBy) => {
  const { data: existing } = await supabaseAdmin
    .from('payroll_months')
    .select('*')
    .eq('month', month)
    .eq('year', year)
    .maybeSingle();

  // Contract: treat initialize as idempotent
  if (existing) return existing;

  const { data, error } = await supabaseAdmin
    .from('payroll_months')
    .insert({ month, year, status: MONTH_STATUS.PENDING, created_by: createdBy })
    .select()
    .single();

  if (error) throw new BadRequestError(error.message);
  return data;
};

const getMonthStatus = async (month, year) => {
  const { data, error } = await supabaseAdmin
    .from('payroll_months')
    .select('*')
    .eq('month', month)
    .eq('year', year)
    .maybeSingle();

  if (error) throw new BadRequestError(error.message);
  return data || null;
};

const generateDraftPayslip = async (payrollMonthId, userId) => {
  const { data: payrollMonth } = await supabaseAdmin
    .from('payroll_months')
    .select('*')
    .eq('id', payrollMonthId)
    .single();

  if (!payrollMonth) throw new NotFoundError('Payroll month not found');
  if (payrollMonth.status === MONTH_STATUS.COMPLETED) {
    throw new BadRequestError('Payroll month is already closed');
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
    const calc = await calculateContractPayslip(employee, summary);

    const { data: updated, error: updErr } = await supabaseAdmin
      .from('payroll')
      .update({
        ...calc,
        payslip_status: PAYSLIP_STATUS.DRAFT,
        payment_status: 'pending',
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .select('*, employee:employee_id(id, first_name, last_name, employee_code, email)')
      .single();
    if (updErr) throw new BadRequestError(updErr.message);
    return mapPayslipRow(updated);
  }

  const { summary } = await attendanceService.getMonthlySummary(userId, payrollMonth.month, payrollMonth.year);
  const calc = await calculateContractPayslip(employee, summary);

  const { data: payslip, error } = await supabaseAdmin
    .from('payroll')
    .insert({
      employee_id: userId,
      payroll_month_id: payrollMonthId,
      month: payrollMonth.month,
      year: payrollMonth.year,
      ...calc,
      payslip_status: PAYSLIP_STATUS.DRAFT,
      payment_status: 'pending',
    })
    .select('*, employee:employee_id(id, first_name, last_name, employee_code, email)')
    .single();

  if (error) throw new BadRequestError(error.message);
  return mapPayslipRow(payslip);
};

const generateAllDraftPayslips = async (payrollMonthId) => {
  const { data: employees, error } = await supabaseAdmin
    .from('employees')
    .select('id')
    .eq('is_active', true);

  if (error) throw new BadRequestError(error.message);

  const results = [];
  for (const emp of employees || []) {
    try {
      const payslip = await generateDraftPayslip(payrollMonthId, emp.id);
      results.push({ user_id: emp.id, status: 'generated', payslip });
    } catch (err) {
      results.push({ user_id: emp.id, status: 'skipped', reason: err.message });
    }
  }
  return results;
};

const generatePayslipPdf = (employee, payslip, payrollMonth) => new Promise((resolve, reject) => {
  const doc = new PDFDocument({ margin: 50 });
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  doc.on('end', () => resolve(Buffer.concat(chunks)));
  doc.on('error', reject);

  const fmt = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  doc.fontSize(18).text(COMPANY_NAME, { align: 'center' });
  doc.fontSize(14).text('PAYSLIP', { align: 'center' });
  doc.moveDown();
  doc.fontSize(12);
  doc.text(`Employee: ${employee.first_name} ${employee.last_name}`);
  doc.text(`Employee Code: ${employee.employee_code || '—'}`);
  doc.text(`Period: ${moment.tz({ year: payrollMonth.year, month: payrollMonth.month - 1 }, TIMEZONE).format('MMMM YYYY')}`);
  doc.moveDown();
  const breakdown = payslip.breakdown_json || {};
  const earnings = breakdown.earnings || [];
  const deductions = breakdown.deductions || [];
  const totals = breakdown.totals || {};

  doc.text('Earnings', { underline: true });
  for (const e of earnings) {
    doc.text(`  ${e.name}: ${fmt(e.amount)}`);
  }
  doc.text(`  Gross Pay: ${fmt(totals.gross_salary ?? payslip.gross_salary)}`);
  doc.moveDown();
  doc.text('Deductions', { underline: true });
  for (const d of deductions) {
    doc.text(`  ${d.name}: ${fmt(d.amount)}`);
  }
  doc.text(`  Total Deductions: ${fmt(totals.total_deductions ?? payslip.total_deductions)}`);
  doc.moveDown();
  doc.fontSize(14).text(`Net Pay: ${fmt(totals.net_pay ?? payslip.net_salary)}`, { underline: true });
  doc.end();
});

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
    .eq('is_active', true);

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

const publishPayslip = async (payslipId, publisherId) => {
  const { data: payslip } = await supabaseAdmin
    .from('payroll')
    .select('*, employee:employee_id(*)')
    .eq('id', payslipId)
    .single();

  if (!payslip) throw new NotFoundError('Payslip not found');
  if (payslip.payslip_status === PAYSLIP_STATUS.PUBLISHED) {
    throw new BadRequestError('Payslip is already published');
  }

  const { data: payrollMonth } = await supabaseAdmin
    .from('payroll_months')
    .select('*')
    .eq('id', payslip.payroll_month_id)
    .single();

  if (!payrollMonth) throw new BadRequestError('Linked payroll month not found');

  const pdfBuffer = await generatePayslipPdf(payslip.employee, payslip, payrollMonth);
  const { path } = await uploadPayslip(pdfBuffer, payslip.employee_id, payslip.month, payslip.year);
  const signedUrl = await getSignedUrl(STORAGE_BUCKETS.payslips, path, 60 * 60 * 24 * 365);

  const { data: updated, error } = await supabaseAdmin
    .from('payroll')
    .update({
      payslip_status: PAYSLIP_STATUS.PUBLISHED,
      payslip_url: signedUrl,
      payment_status: 'processed',
    })
    .eq('id', payslipId)
    .select('*, employee:employee_id(id, first_name, last_name, employee_code)')
    .single();

  if (error) throw new BadRequestError(error.message);

  await maybeCloseMonth(payslip.payroll_month_id);
  logger.info('Payslip published', { payslipId, publisherId });

  // Notify employee
  await notificationService.createNotification({
    user_id: payslip.employee_id,
    type: 'PAYROLL',
    title: 'Payslip published',
    message: `Your payslip for ${moment.tz({ year: payslip.year, month: payslip.month - 1 }, TIMEZONE).format('MMMM YYYY')} is now available.`,
    link: '/payroll',
    meta: { payslip_id: payslipId, month: payslip.month, year: payslip.year },
  });

  return {
    id: updated.id,
    status: PAYSLIP_STATUS.PUBLISHED,
    payslip_url: updated.payslip_url,
    ...mapPayslipRow(updated),
  };
};

const listPayslips = async ({ month, year, user, role }) => {
  let query = supabaseAdmin
    .from('payroll')
    .select('*, employee:employee_id(id, first_name, last_name, employee_code, email)')
    .eq('month', month)
    .eq('year', year)
    .order('created_at', { ascending: false });

  if (role === 'employee') {
    query = query.eq('employee_id', user.id).eq('payslip_status', PAYSLIP_STATUS.PUBLISHED);
  }

  const { data, error } = await query;
  if (error) throw new BadRequestError(error.message);
  return (data || []).map(mapPayslipRow);
};

const downloadPayslip = async (payslipId, user) => {
  const { data: payslip } = await supabaseAdmin
    .from('payroll')
    .select('*, employee:employee_id(id, first_name, last_name)')
    .eq('id', payslipId)
    .single();

  if (!payslip) throw new NotFoundError('Payslip not found');

  const isOwn = payslip.employee_id === user.id;
  const isHrAdmin = ['hr', 'admin'].includes(user.role);
  if (!isOwn && !isHrAdmin) throw new ForbiddenError('Not authorized');

  // Contract: draft download forbidden for everyone
  if (payslip.payslip_status === PAYSLIP_STATUS.DRAFT) {
    throw new ForbiddenError('Payslip is not published yet');
  }

  if (!payslip.payslip_url) throw new NotFoundError('Payslip PDF not available');

  return { redirectUrl: payslip.payslip_url, payslip: mapPayslipRow(payslip) };
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
  mapPayslipRow,
};
