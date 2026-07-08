const PDFDocument = require('pdfkit');
const { supabaseAdmin } = require('../config/supabase');
const {
  BadRequestError, NotFoundError, ConflictError,
} = require('../utils/errors');
const { paginate, buildMeta } = require('../utils/helpers');
const { uploadPayslip, getSignedUrl, STORAGE_BUCKETS } = require('./storage.service');
const { payslipEmail } = require('./email.service');
const logger = require('../utils/logger');

const calculatePayroll = (employee, attendanceSummary, overrides = {}) => {
  const salary = employee.salary_details || {};
  const basic = parseFloat(overrides.basic_salary ?? salary.basic ?? 0);
  const hra = parseFloat(overrides.hra ?? salary.hra ?? basic * 0.4);
  const specialAllowance = parseFloat(overrides.special_allowance ?? salary.special_allowance ?? 0);
  const transportAllowance = parseFloat(overrides.transport_allowance ?? salary.transport_allowance ?? 0);
  const medicalAllowance = parseFloat(overrides.medical_allowance ?? salary.medical_allowance ?? 0);
  const bonus = parseFloat(overrides.bonus ?? 0);

  const overtimeRate = (basic / 30 / 9) * 1.5;
  const overtimePay = parseFloat(overrides.overtime_pay ?? (attendanceSummary?.overtimeHours || 0) * overtimeRate);

  const grossSalary = basic + hra + specialAllowance + transportAllowance + medicalAllowance + bonus + overtimePay;

  const pfDeduction = Math.min(basic * 0.12, 1800);
  const esiDeduction = grossSalary <= 21000 ? grossSalary * 0.0075 : 0;
  const professionalTax = grossSalary > 15000 ? 200 : 0;
  const tds = parseFloat(overrides.tds ?? (grossSalary > 50000 ? grossSalary * 0.1 : 0));

  const absentDays = Math.max(0, 22 - (attendanceSummary?.present || 0) - (attendanceSummary?.halfDay || 0) * 0.5);
  const leaveDeduction = parseFloat(overrides.leave_deduction ?? (basic / 30) * absentDays);

  const otherDeductions = parseFloat(overrides.other_deductions ?? 0);
  const totalDeductions = pfDeduction + esiDeduction + tds + professionalTax + leaveDeduction + otherDeductions;
  const netSalary = Math.max(0, grossSalary - totalDeductions);

  return {
    basic_salary: Math.round(basic * 100) / 100,
    hra: Math.round(hra * 100) / 100,
    special_allowance: Math.round(specialAllowance * 100) / 100,
    transport_allowance: Math.round(transportAllowance * 100) / 100,
    medical_allowance: Math.round(medicalAllowance * 100) / 100,
    bonus: Math.round(bonus * 100) / 100,
    overtime_pay: Math.round(overtimePay * 100) / 100,
    gross_salary: Math.round(grossSalary * 100) / 100,
    pf_deduction: Math.round(pfDeduction * 100) / 100,
    esi_deduction: Math.round(esiDeduction * 100) / 100,
    tds: Math.round(tds * 100) / 100,
    professional_tax: Math.round(professionalTax * 100) / 100,
    leave_deduction: Math.round(leaveDeduction * 100) / 100,
    other_deductions: Math.round(otherDeductions * 100) / 100,
    total_deductions: Math.round(totalDeductions * 100) / 100,
    net_salary: Math.round(netSalary * 100) / 100,
  };
};

const generatePayslipPdf = (employee, payroll) => new Promise((resolve, reject) => {
  const doc = new PDFDocument({ margin: 50 });
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  doc.on('end', () => resolve(Buffer.concat(chunks)));
  doc.on('error', reject);

  doc.fontSize(18).text('PAYSLIP', { align: 'center' });
  doc.moveDown();
  doc.fontSize(12);
  doc.text(`Employee: ${employee.first_name} ${employee.last_name}`);
  doc.text(`Code: ${employee.employee_code}`);
  doc.text(`Period: ${payroll.month}/${payroll.year}`);
  doc.moveDown();
  doc.text('Earnings:');
  doc.text(`  Basic Salary: ₹${payroll.basic_salary}`);
  doc.text(`  HRA: ₹${payroll.hra}`);
  doc.text(`  Special Allowance: ₹${payroll.special_allowance}`);
  doc.text(`  Transport: ₹${payroll.transport_allowance}`);
  doc.text(`  Medical: ₹${payroll.medical_allowance}`);
  doc.text(`  Bonus: ₹${payroll.bonus}`);
  doc.text(`  Overtime: ₹${payroll.overtime_pay}`);
  doc.text(`  Gross: ₹${payroll.gross_salary}`);
  doc.moveDown();
  doc.text('Deductions:');
  doc.text(`  PF: ₹${payroll.pf_deduction}`);
  doc.text(`  ESI: ₹${payroll.esi_deduction}`);
  doc.text(`  TDS: ₹${payroll.tds}`);
  doc.text(`  Professional Tax: ₹${payroll.professional_tax}`);
  doc.text(`  Leave Deduction: ₹${payroll.leave_deduction}`);
  doc.text(`  Other: ₹${payroll.other_deductions}`);
  doc.text(`  Total Deductions: ₹${payroll.total_deductions}`);
  doc.moveDown();
  doc.fontSize(14).text(`Net Salary: ₹${payroll.net_salary}`, { underline: true });
  doc.end();
});

const generatePayroll = async (month, year, employeeIds = null) => {
  let employeeQuery = supabaseAdmin.from('employees').select('*').eq('is_active', true);
  if (employeeIds?.length) employeeQuery = employeeQuery.in('id', employeeIds);

  const { data: employees, error } = await employeeQuery;
  if (error) throw new BadRequestError(error.message);

  const results = [];
  for (const employee of employees) {
    const { data: existing } = await supabaseAdmin
      .from('payroll')
      .select('id')
      .eq('employee_id', employee.id)
      .eq('month', month)
      .eq('year', year)
      .single();

    if (existing) {
      results.push({ employee_id: employee.id, status: 'skipped', reason: 'already exists' });
      continue;
    }

    const attendanceService = require('./attendance.service');
    const { summary } = await attendanceService.getMonthlySummary(employee.id, month, year);
    const payrollData = calculatePayroll(employee, summary);

    const { data: payroll, error: insertError } = await supabaseAdmin
      .from('payroll')
      .insert({
        employee_id: employee.id,
        month,
        year,
        ...payrollData,
        payment_status: 'pending',
      })
      .select()
      .single();

    if (insertError) {
      results.push({ employee_id: employee.id, status: 'failed', reason: insertError.message });
      continue;
    }

    try {
      const pdfBuffer = await generatePayslipPdf(employee, payroll);
      const { path } = await uploadPayslip(pdfBuffer, employee.id, month, year);
      await supabaseAdmin.from('payroll').update({ payslip_url: path }).eq('id', payroll.id);
      payslipEmail(employee, payroll).catch(() => {});
    } catch (pdfErr) {
      logger.warn('Payslip PDF generation failed', { employeeId: employee.id, error: pdfErr.message });
    }

    results.push({ employee_id: employee.id, status: 'generated', payroll_id: payroll.id });
  }

  return results;
};

const getPayslips = async (filters, query) => {
  const { page, limit, offset } = paginate(query);
  let dbQuery = supabaseAdmin
    .from('payroll')
    .select('*, employee:employee_id(id, first_name, last_name, employee_code)', { count: 'exact' })
    .order('year', { ascending: false })
    .order('month', { ascending: false })
    .range(offset, offset + limit - 1);

  if (filters.employee_id) dbQuery = dbQuery.eq('employee_id', filters.employee_id);
  if (filters.month) dbQuery = dbQuery.eq('month', filters.month);
  if (filters.year) dbQuery = dbQuery.eq('year', filters.year);

  const { data, error, count } = await dbQuery;
  if (error) throw new BadRequestError(error.message);
  return { data, meta: buildMeta(page, limit, count) };
};

const getPayslipDownload = async (payslipId, employeeId = null) => {
  let query = supabaseAdmin.from('payroll').select('*, employee:employee_id(*)').eq('id', payslipId);
  if (employeeId) query = query.eq('employee_id', employeeId);

  const { data: payroll } = await query.single();
  if (!payroll) throw new NotFoundError('Payslip not found');

  if (payroll.payslip_url) {
    const url = await getSignedUrl(STORAGE_BUCKETS.payslips, payroll.payslip_url);
    return { url, payroll };
  }

  const pdfBuffer = await generatePayslipPdf(payroll.employee, payroll);
  return { buffer: pdfBuffer, payroll, contentType: 'application/pdf' };
};

const updatePayroll = async (payrollId, updates) => {
  const { data: existing } = await supabaseAdmin.from('payroll').select('*').eq('id', payrollId).single();
  if (!existing) throw new NotFoundError('Payroll record not found');

  const merged = { ...existing, ...updates };
  const recalculated = calculatePayroll(
    { salary_details: {} },
    {},
    merged
  );

  const { data, error } = await supabaseAdmin
    .from('payroll')
    .update(recalculated)
    .eq('id', payrollId)
    .select()
    .single();

  if (error) throw new BadRequestError(error.message);
  return data;
};

const getMonthlyReport = async (month, year) => {
  const { data, error } = await supabaseAdmin
    .from('payroll')
    .select('*, employee:employee_id(first_name, last_name, employee_code, department)')
    .eq('month', month)
    .eq('year', year);

  if (error) throw new BadRequestError(error.message);

  const report = {
    totalEmployees: data.length,
    totalGross: data.reduce((s, p) => s + parseFloat(p.gross_salary), 0),
    totalDeductions: data.reduce((s, p) => s + parseFloat(p.total_deductions), 0),
    totalNet: data.reduce((s, p) => s + parseFloat(p.net_salary), 0),
    byStatus: {
      pending: data.filter((p) => p.payment_status === 'pending').length,
      processed: data.filter((p) => p.payment_status === 'processed').length,
      paid: data.filter((p) => p.payment_status === 'paid').length,
    },
    records: data,
  };

  return report;
};

module.exports = {
  generatePayroll,
  getPayslips,
  getPayslipDownload,
  updatePayroll,
  getMonthlyReport,
  calculatePayroll,
};
