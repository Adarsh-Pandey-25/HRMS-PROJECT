/**
 * Monthly statutory files from published payslips (report §7.8):
 *  - EPF ECR: the text file the EPFO Unified Portal takes for the monthly
 *    return — one line per member, fields joined by #~# (ECR 2.0 layout):
 *    UAN, name, gross wages, EPF wages, EPS wages, EDLI wages, EPF (employee)
 *    contribution, EPS contribution, EPF−EPS difference (employer), NCP days,
 *    refund of advances. Whole rupees.
 *  - ESI: the monthly contribution rows (IP number, name, days paid, wages,
 *    reason code, last working day) to paste into ESIC's upload template.
 * Members without a UAN / ESIC number are left out and listed. The layouts
 * are to be checked by uploading to the portals (docs/payroll-statutory-values.md).
 * Read-only.
 */
const moment = require('moment-timezone');
const { supabaseAdmin } = require('../config/supabase');
const { BadRequestError } = require('../utils/errors');
const { TIMEZONE } = require('../utils/constants');
const { toPaise, toRupees } = require('../payroll/money');
const { csvCell } = require('./tdsRegister.service');
const { selectIn } = require('../utils/selectIn');

const checkMonth = (month, year) => {
  const m = Number(month);
  const y = Number(year);
  if (!(m >= 1 && m <= 12) || !(y >= 2000 && y <= 2100)) throw new BadRequestError('month and year are required');
  return { m, y };
};

const loadMonth = async (companyId, m, y) => {
  if (!companyId) throw new BadRequestError('companyId is required');
  const { data: slips, error } = await supabaseAdmin
    .from('payroll')
    .select('id, employee_id, month, year, gross_salary, pf_deduction, unpaid_leave_days, payslip_status, breakdown_json, company_id')
    .eq('company_id', companyId)
    .eq('month', m)
    .eq('year', y)
    .eq('payslip_status', 'PUBLISHED');
  if (error) throw new BadRequestError(error.message);
  const ids = [...new Set((slips || []).map((s) => String(s.employee_id)))];
  let employees = [];
  if (ids.length) {
    const { data, error: empErr } = await selectIn(supabaseAdmin, 'employees', 'id, first_name, last_name, employee_code, salary_details', 'id', ids);
    if (empErr) throw new BadRequestError(empErr.message);
    employees = data || [];
  }
  const byId = new Map(employees.map((e) => [String(e.id), e]));
  return (slips || []).map((s) => ({ slip: s, employee: byId.get(String(s.employee_id)) || null }));
};

const nameOf = (e) => `${e?.first_name || ''} ${e?.last_name || ''}`.trim() || e?.employee_code || 'Employee';
const amountOf = (list, name) => Number((list || []).find((x) => x.name === name)?.amount || 0);
const whole = (rupees) => Math.round(toPaise(rupees) / 100); // stored amounts are whole rupees already

/** The ECR line's values for one published payslip, or null when no PF was charged. */
const ecrValues = (slip) => {
  const b = slip.breakdown_json || {};
  const cfg = b.config || {};
  const employeePf = Number(slip.pf_deduction || 0) + amountOf(b.deductions, 'VPF');
  const eps = amountOf(b.employer_contributions, 'Employer PF — pension (EPS)');
  const epfEmployer = amountOf(b.employer_contributions, 'Employer PF — EPF');
  if (!(employeePf > 0) && !(eps > 0) && !(epfEmployer > 0)) return null;
  const wagesUsed = Number(cfg.pf_wages_used ?? cfg.pf_wages ?? 0);
  const ceiling = cfg.pf_ceiling != null ? Number(cfg.pf_ceiling) : wagesUsed;
  const epsWages = cfg.eps_wages != null ? Number(cfg.eps_wages) : (eps > 0 ? Math.min(wagesUsed, ceiling) : 0);
  const edliWages = cfg.edli_wages != null ? Number(cfg.edli_wages) : Math.min(wagesUsed, ceiling);
  return {
    gross: whole(slip.gross_salary),
    epfWages: whole(wagesUsed),
    epsWages: whole(epsWages),
    edliWages: whole(edliWages),
    employeePf: whole(employeePf),
    eps: whole(eps),
    epfEmployer: whole(epfEmployer),
    // Non-contributing days: the month's unpaid days, to a whole day.
    ncpDays: Math.round(Number(slip.unpaid_leave_days || 0)),
  };
};

/** The month's EPF ECR file (text) and the members left out. */
const getEcrFile = async (companyId, month, year) => {
  const { m, y } = checkMonth(month, year);
  const rows = await loadMonth(companyId, m, y);
  const lines = [];
  const skipped = [];
  const totals = { employeePf: 0, eps: 0, epfEmployer: 0 };
  for (const { slip, employee } of rows) {
    const v = ecrValues(slip);
    if (!v) continue;
    const uan = String(employee?.salary_details?.statutory_ids?.uan || '');
    if (!/^\d{12}$/.test(uan)) {
      skipped.push({ employeeId: slip.employee_id, name: nameOf(employee), reason: 'No UAN recorded' });
      continue;
    }
    // The portal reads #~# as the separator, so it can't appear inside a name.
    const name = nameOf(employee).replace(/#~#/g, ' ').replace(/[\r\n]+/g, ' ').toUpperCase();
    lines.push([uan, name, v.gross, v.epfWages, v.epsWages, v.edliWages, v.employeePf, v.eps, v.epfEmployer, v.ncpDays, 0].join('#~#'));
    totals.employeePf += v.employeePf;
    totals.eps += v.eps;
    totals.epfEmployer += v.epfEmployer;
  }
  return {
    text: lines.length ? `${lines.join('\r\n')}\r\n` : '',
    filename: `ecr-${y}-${String(m).padStart(2, '0')}.txt`,
    members: lines.length,
    totals,
    skipped,
  };
};

/** The month's ESI contribution rows (CSV for ESIC's upload template) and those left out. */
const getEsiFile = async (companyId, month, year) => {
  const { m, y } = checkMonth(month, year);
  const rows = await loadMonth(companyId, m, y);
  const header = ['IP Number', 'IP Name', 'No of Days for which wages paid/payable during the month', 'Total Monthly Wages', 'Reason Code for Zero workings days', 'Last Working Day'];
  const out = [];
  const skipped = [];
  let wagesPaise = 0;
  const monthEnd = moment.tz({ year: y, month: m - 1, day: 1 }, TIMEZONE).endOf('month').format('YYYY-MM-DD');
  for (const { slip, employee } of rows) {
    const cfg = slip.breakdown_json?.config || {};
    if (cfg.esi_eligible !== true) continue;
    const ip = String(employee?.salary_details?.statutory_ids?.esic_ip || '');
    if (!/^\d{10}$/.test(ip)) {
      skipped.push({ employeeId: slip.employee_id, name: nameOf(employee), reason: 'No ESIC number recorded' });
      continue;
    }
    const leftOn = cfg.left_on && cfg.left_on <= monthEnd ? moment.tz(cfg.left_on, TIMEZONE).format('DD/MM/YYYY') : '';
    wagesPaise += toPaise(slip.gross_salary);
    out.push([
      ip,
      nameOf(employee),
      // Days wages were paid for: calendar days, weekly offs included.
      Math.round(Number(cfg.esi_paid_days ?? cfg.paid_days ?? 0)),
      whole(slip.gross_salary),
      '',
      leftOn,
    ]);
  }
  const csv = [header, ...out].map((r) => r.map(csvCell).join(',')).join('\r\n');
  return {
    csv: `${csv}\r\n`,
    filename: `esi-contribution-${y}-${String(m).padStart(2, '0')}.csv`,
    members: out.length,
    totalWages: toRupees(wagesPaise),
    skipped,
  };
};

module.exports = { getEcrFile, getEsiFile, ecrValues };
