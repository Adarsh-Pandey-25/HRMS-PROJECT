/**
 * An employee's annual salary and tax statement for a tax year — the figures
 * behind their annual TDS certificate (Form 130 Part B, formerly Form 16),
 * worked out on the actual year: published payslips, plus salary and TDS
 * from outside SpaxSync and the deductions HR allowed (tax profile). It is
 * not the certificate itself: the CA issues that (Part A comes from the
 * TDS portal). Read-only; amounts in rupees.
 */
const { supabaseAdmin } = require('../config/supabase');
const { BadRequestError, NotFoundError } = require('../utils/errors');
const { toPaise, toRupees } = require('../payroll/money');
const { annualTax } = require('../payroll/incomeTax');
const { TAX_YEARS } = require('../payroll/taxRules');
const tds = require('../payroll/tds');

const QUARTERS = [
  { key: 'Q1', months: [4, 5, 6] },
  { key: 'Q2', months: [7, 8, 9] },
  { key: 'Q3', months: [10, 11, 12] },
  { key: 'Q4', months: [1, 2, 3] },
];

const startOf = (taxYear) => {
  const m = /^(\d{4})-(\d{2})$/.exec(String(taxYear || ''));
  if (!m || Number(m[2]) !== (Number(m[1]) + 1) % 100) throw new BadRequestError('Tax year must look like 2026-27');
  return Number(m[1]);
};

const getAnnualTaxStatement = async (companyId, employeeId, taxYear) => {
  if (!companyId) throw new BadRequestError('companyId is required');
  const start = startOf(taxYear);
  const rules = TAX_YEARS.find((t) => t.taxYear === taxYear);
  if (!rules) throw new BadRequestError(`Income-tax rates for ${taxYear} aren't set up in SpaxSync`);

  const { data: employee, error: empErr } = await supabaseAdmin
    .from('employees')
    .select('id, company_id, first_name, last_name, employee_code, designation, date_of_birth, salary_details')
    .eq('id', employeeId)
    .maybeSingle();
  if (empErr) throw new BadRequestError(empErr.message);
  if (!employee || String(employee.company_id) !== String(companyId)) throw new NotFoundError('Employee not found');

  const { data: rows, error } = await supabaseAdmin
    .from('payroll')
    .select('month, year, gross_salary, professional_tax, tds, payslip_status, company_id, breakdown_json')
    .eq('employee_id', employeeId)
    .in('year', [start, start + 1]);
  if (error) throw new BadRequestError(error.message);
  const inYear = (r) => (Number(r.year) === start && Number(r.month) >= 4) || (Number(r.year) === start + 1 && Number(r.month) <= 3);
  const slips = (rows || []).filter((r) => inYear(r)
    && String(r.payslip_status || '').toUpperCase() === 'PUBLISHED'
    && (!r.company_id || String(r.company_id) === String(companyId)));
  const drafts = (rows || []).filter((r) => inYear(r) && String(r.payslip_status || '').toUpperCase() !== 'PUBLISHED').length;

  // The company's regime for employees who haven't chosen one (by law: the new regime).
  const calc = require('../payroll/companyRules').resolveCompanyCalc(
    await require('./settings.service').getSetting('payroll_calc', null, companyId),
  );
  const profile = tds.resolveTaxProfile(employee.salary_details, taxYear, calc.tds.defaultRegime);
  const regime = rules.regimes[profile.regime];
  const sum = (key) => slips.reduce((s, r) => s + toPaise(r[key]), 0);
  // Salary on the payslips, less one-time pay marked not taxable (e.g. exempt gratuity).
  const exemptOneTime = slips.reduce((s, r) => s + (r.breakdown_json?.config?.one_time || [])
    .filter((i) => i && i.earning && i.taxable === false)
    .reduce((a, i) => a + toPaise(i.amount), 0), 0);
  const salaryHere = Math.max(0, sum('gross_salary') - exemptOneTime);
  const ptPaid = sum('professional_tax');
  const tdsHere = sum('tds');
  const outside = profile.previous_employer_income + profile.earlier_income;
  const salary = salaryHere + outside;
  const standardDeduction = Math.min(regime.standardDeduction, salary);
  const old = profile.regime === 'old';
  const exemptions = old ? profile.hra_exemption + profile.lta_exemption : 0;
  const chapter8 = old ? profile.chapter8_deductions : 0;
  const otherDeductions = old ? profile.other_deductions : 0;
  const pt = old ? ptPaid : 0;
  const ageBand = old ? tds.ageBandInTaxYear(employee.date_of_birth, taxYear) : null;
  const taxable = Math.max(0, salary + profile.other_income - standardDeduction - pt - exemptions - chapter8 - otherDeductions);
  const tax = annualTax(taxable, regime, { ageBand: ageBand === 'under_60' ? null : ageBand });
  const tdsOutside = profile.previous_employer_tds + profile.earlier_tds;
  const tdsTotal = tdsHere + tdsOutside;
  const R = toRupees;

  return {
    taxYear,
    employee: {
      id: employee.id,
      name: `${employee.first_name || ''} ${employee.last_name || ''}`.trim(),
      code: employee.employee_code || '',
      designation: employee.designation || '',
      pan: String(employee.salary_details?.statutory_ids?.pan || '').toUpperCase() || null,
    },
    regime: profile.regime,
    ageBand: old ? (ageBand || 'unknown') : null,
    months: slips.length,
    draftsNotCounted: drafts,
    salary: {
      paidHere: R(salaryHere),
      previousEmployer: R(profile.previous_employer_income),
      outsideSpaxSync: R(profile.earlier_income),
      total: R(salary),
    },
    exemptions: R(exemptions),
    standardDeduction: R(standardDeduction),
    professionalTax: R(pt),
    incomeFromSalary: R(Math.max(0, salary - exemptions - standardDeduction - pt)),
    otherIncome: R(profile.other_income),
    chapter8Deductions: R(chapter8),
    otherDeductions: R(otherDeductions),
    taxableIncome: R(tax.taxableIncome),
    tax: {
      onIncome: R(tax.slabTax),
      rebate: R(tax.rebate),
      surcharge: R(tax.surcharge),
      cess: R(tax.cess),
      total: R(tax.total),
    },
    tds: {
      byQuarter: QUARTERS.map((q) => ({
        quarter: q.key,
        amount: R(slips.filter((r) => q.months.includes(Number(r.month))).reduce((s, r) => s + toPaise(r.tds), 0)),
      })),
      here: R(tdsHere),
      previousEmployer: R(profile.previous_employer_tds),
      outsideSpaxSync: R(profile.earlier_tds),
      total: R(tdsTotal),
    },
    // Positive: tax still owed for the year; negative: deducted more than due (refund via the return).
    balance: R(tax.total - tdsTotal),
  };
};

module.exports = { getAnnualTaxStatement };
