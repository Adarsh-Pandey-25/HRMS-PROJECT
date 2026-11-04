/**
 * A month's payroll reports from published payslips (report §7.8):
 *  - Salary register: one row per employee — paid days, every earning and
 *    deduction, gross, net, employer contributions, net payable.
 *  - Journal: the month's accounting entry — salary expense by component,
 *    employer contributions and reimbursements debited; net pay and each
 *    deduction credited as payable. It always balances (any paise from
 *    rounding the net payable go to "Rounding off").
 * Read-only; amounts in rupees.
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

const loadPublished = async (companyId, m, y) => {
  if (!companyId) throw new BadRequestError('companyId is required');
  const { data: slips, error } = await supabaseAdmin
    .from('payroll')
    .select('id, employee_id, month, year, gross_salary, total_deductions, net_salary, payslip_status, breakdown_json, company_id')
    .eq('company_id', companyId)
    .eq('month', m)
    .eq('year', y)
    .eq('payslip_status', 'PUBLISHED');
  if (error) throw new BadRequestError(error.message);
  const ids = [...new Set((slips || []).map((s) => String(s.employee_id)))];
  let employees = [];
  if (ids.length) {
    const { data, error: empErr } = await selectIn(supabaseAdmin, 'employees', 'id, first_name, last_name, employee_code, department', 'id', ids);
    if (empErr) throw new BadRequestError(empErr.message);
    employees = data || [];
  }
  const byId = new Map(employees.map((e) => [String(e.id), e]));
  return (slips || [])
    .map((s) => ({ slip: s, employee: byId.get(String(s.employee_id)) || null }))
    .sort((a, b) => String(a.employee?.employee_code || '').localeCompare(String(b.employee?.employee_code || ''))
      || nameOf(a.employee).localeCompare(nameOf(b.employee)));
};

const nameOf = (e) => `${e?.first_name || ''} ${e?.last_name || ''}`.trim() || e?.employee_code || 'Employee';
const lines = (list) => (Array.isArray(list) ? list : []).map((x) => ({ name: String(x.name || ''), paise: toPaise(x.amount) }));
const totalsOf = (slip) => slip.breakdown_json?.totals || {};
const netPayablePaise = (slip) => {
  const t = totalsOf(slip);
  return toPaise(t.net_payable ?? (Number(slip.net_salary || 0) + Number(t.total_reimbursements || 0)));
};
const reimbursementPaise = (slip) => toPaise(totalsOf(slip).total_reimbursements || 0);
const money = (paise) => toRupees(paise).toFixed(2);

/** Every distinct name in order of first appearance. */
const namesIn = (rows, pick) => {
  const seen = [];
  for (const r of rows) for (const l of pick(r)) if (!seen.includes(l.name)) seen.push(l.name);
  return seen;
};

/** The month's salary register as CSV. */
const getSalaryRegister = async (companyId, month, year) => {
  const { m, y } = checkMonth(month, year);
  const rows = await loadPublished(companyId, m, y);
  const earn = (r) => lines(r.slip.breakdown_json?.earnings);
  const ded = (r) => lines(r.slip.breakdown_json?.deductions);
  const er = (r) => lines(r.slip.breakdown_json?.employer_contributions);
  const earningNames = namesIn(rows, earn);
  const deductionNames = namesIn(rows, ded);
  const employerNames = namesIn(rows, er);
  const header = [
    'Employee code', 'Employee name', 'Department', 'Paid days',
    ...earningNames, 'Gross',
    ...deductionNames, 'Total deductions', 'Net pay', 'Reimbursements', 'Net payable',
    ...employerNames.map((n) => `${n} (employer)`),
  ];
  const sumBy = (list, name) => list.filter((l) => l.name === name).reduce((s, l) => s + l.paise, 0);
  const totals = new Array(header.length).fill(0);
  const body = rows.map((r) => {
    const cfg = r.slip.breakdown_json?.config || {};
    const values = [
      ...earningNames.map((n) => sumBy(earn(r), n)),
      toPaise(r.slip.gross_salary),
      ...deductionNames.map((n) => sumBy(ded(r), n)),
      toPaise(r.slip.total_deductions),
      toPaise(r.slip.net_salary),
      reimbursementPaise(r.slip),
      netPayablePaise(r.slip),
      ...employerNames.map((n) => sumBy(er(r), n)),
    ];
    values.forEach((v, i) => { totals[4 + i] += v; });
    return [
      r.employee?.employee_code || '',
      nameOf(r.employee),
      r.employee?.department || '',
      cfg.paid_days ?? '',
      ...values.map(money),
    ];
  });
  const totalRow = ['', 'Total', '', '', ...totals.slice(4).map(money)];
  const csv = [header, ...body, ...(body.length ? [totalRow] : [])].map((r) => r.map(csvCell).join(',')).join('\r\n');
  return { csv: `${csv}\r\n`, filename: `salary-register-${y}-${String(m).padStart(2, '0')}.csv`, employees: body.length };
};

// Where each deduction is owed, for the journal's credit side.
const PAYABLE_ACCOUNT = {
  PF: 'PF payable',
  VPF: 'PF payable',
  ESI: 'ESI payable',
  'Professional Tax': 'Professional Tax payable',
  'Labour Welfare Fund': 'LWF payable',
  TDS: 'TDS payable (salary)',
};
const EMPLOYER_ACCOUNT = (name) => {
  if (/ESI/i.test(name)) return { expense: 'Employer ESI contribution', payable: 'ESI payable' };
  if (/LWF/i.test(name)) return { expense: 'Employer LWF contribution', payable: 'LWF payable' };
  return { expense: 'Employer PF contribution', payable: 'PF payable' };
};
/**
 * A payslip's recoveries, by line name: loan and advance instalments reduce
 * the staff loans the company is owed; notice not served and other one-time
 * recoveries are recovered by the company (not payable to anyone).
 */
const recoveryAccounts = (cfg = {}) => {
  const accounts = new Map();
  for (const l of Array.isArray(cfg.loans) ? cfg.loans : []) accounts.set(l.name, 'Staff loans and advances');
  for (const r of Array.isArray(cfg.one_time) ? cfg.one_time : []) {
    if (r && r.earning === false) accounts.set(r.name, r.kind === 'notice_recovery' ? 'Notice pay recovered' : 'Other recoveries from staff');
  }
  return accounts;
};

/**
 * The month's journal entry as CSV (Date, Account, Debit, Credit, Narration)
 * and as lines; `balanced` is always true unless stored payslips disagree
 * with themselves (then the difference shows as "Rounding off").
 */
const getJournal = async (companyId, month, year) => {
  const { m, y } = checkMonth(month, year);
  const rows = await loadPublished(companyId, m, y);
  const debit = new Map();
  const credit = new Map();
  const add = (map, account, paise) => { if (paise) map.set(account, (map.get(account) || 0) + paise); };
  for (const { slip } of rows) {
    const b = slip.breakdown_json || {};
    for (const e of lines(b.earnings)) add(debit, `Salaries — ${e.name}`, e.paise);
    // Legacy rows without an earnings list: the gross as one line.
    if (!lines(b.earnings).length) add(debit, 'Salaries', toPaise(slip.gross_salary));
    for (const c of lines(b.employer_contributions)) {
      const acc = EMPLOYER_ACCOUNT(c.name);
      add(debit, acc.expense, c.paise);
      add(credit, acc.payable, c.paise);
    }
    add(debit, 'Staff reimbursements', reimbursementPaise(slip));
    const recoveries = recoveryAccounts(b.config);
    for (const d of lines(b.deductions)) add(credit, recoveries.get(d.name) || PAYABLE_ACCOUNT[d.name] || `${d.name} payable`, d.paise);
    add(credit, 'Salary payable', netPayablePaise(slip));
  }
  const dr = [...debit.values()].reduce((s, v) => s + v, 0);
  const cr = [...credit.values()].reduce((s, v) => s + v, 0);
  // Net payable is rounded to the rupee; those paise balance here.
  if (dr !== cr) {
    if (dr > cr) add(credit, 'Rounding off', dr - cr);
    else add(debit, 'Rounding off', cr - dr);
  }
  const date = moment.tz({ year: y, month: m - 1, day: 1 }, TIMEZONE).endOf('month').format('YYYY-MM-DD');
  const narration = `Salaries for ${moment.tz({ year: y, month: m - 1, day: 1 }, TIMEZONE).format('MMMM YYYY')} (${rows.length} payslip${rows.length === 1 ? '' : 's'})`;
  const entries = [
    ...[...debit.entries()].map(([account, paise]) => ({ account, debit: toRupees(paise), credit: 0 })),
    ...[...credit.entries()].map(([account, paise]) => ({ account, debit: 0, credit: toRupees(paise) })),
  ];
  const header = ['Date', 'Account', 'Debit (Rs)', 'Credit (Rs)', 'Narration'];
  const csv = [header, ...entries.map((e) => [date, e.account, e.debit ? e.debit.toFixed(2) : '', e.credit ? e.credit.toFixed(2) : '', narration])]
    .map((r) => r.map(csvCell).join(',')).join('\r\n');
  const totalDr = entries.reduce((s, e) => s + toPaise(e.debit), 0);
  const totalCr = entries.reduce((s, e) => s + toPaise(e.credit), 0);
  return {
    csv: `${csv}\r\n`,
    filename: `payroll-journal-${y}-${String(m).padStart(2, '0')}.csv`,
    entries,
    totalDebit: toRupees(totalDr),
    totalCredit: toRupees(totalCr),
    balanced: totalDr === totalCr,
    roundingOff: toRupees(Math.abs(dr - cr)),
  };
};

/**
 * The month's Professional Tax or LWF register, by state, for each state's
 * return: one row per employee who paid it (PT: gross and PT; LWF: the
 * employee's and the employer's share), and a total row per state. CSV.
 */
const getStateRegister = async (companyId, month, year, kind) => {
  const { m, y } = checkMonth(month, year);
  if (!['pt', 'lwf'].includes(kind)) throw new BadRequestError('Register must be pt or lwf');
  const rows = await loadPublished(companyId, m, y);
  const byState = new Map();
  for (const { slip, employee } of rows) {
    const cfg = slip.breakdown_json?.config || {};
    let line = null;
    if (kind === 'pt') {
      const pt = toPaise(cfg.professional_tax);
      if (pt > 0) line = { state: cfg.pt_state || '—', amounts: [toPaise(slip.gross_salary), pt] };
    } else if (cfg.lwf && (toPaise(cfg.lwf.employee) > 0 || toPaise(cfg.lwf.employer) > 0)) {
      line = { state: cfg.lwf.state || '—', amounts: [toPaise(cfg.lwf.employee), toPaise(cfg.lwf.employer)] };
    }
    if (!line) continue;
    if (!byState.has(line.state)) byState.set(line.state, []);
    byState.get(line.state).push([employee?.employee_code || '', nameOf(employee), ...line.amounts]);
  }
  const header = kind === 'pt'
    ? ['State', 'Employee code', 'Employee name', 'Gross', 'Professional Tax']
    : ['State', 'Employee code', 'Employee name', 'Employee LWF', 'Employer LWF'];
  const body = [];
  for (const state of [...byState.keys()].sort()) {
    const list = byState.get(state);
    for (const r of list) body.push([state, r[0], r[1], money(r[2]), money(r[3])]);
    body.push([state, '', 'Total', money(list.reduce((s, r) => s + r[2], 0)), money(list.reduce((s, r) => s + r[3], 0))]);
  }
  const csv = [header, ...body].map((r) => r.map(csvCell).join(',')).join('\r\n');
  return {
    csv: `${csv}\r\n`,
    filename: `${kind === 'pt' ? 'professional-tax' : 'lwf'}-register-${y}-${String(m).padStart(2, '0')}.csv`,
    employees: body.filter((r) => r[2] !== 'Total').length,
  };
};

/**
 * Do the month's figures agree (master prompt §7.3)? Each worked out on its
 * own from the published payslips: their net payable, the salary register's
 * total row, the bank file (with what it left out for missing bank details)
 * and the journal's salary payable — and the journal balances. Read-only.
 */
const getReconciliation = async (companyId, month, year) => {
  const { m, y } = checkMonth(month, year);
  const rows = await loadPublished(companyId, m, y);
  const payslips = rows.reduce((s, { slip }) => s + netPayablePaise(slip), 0);
  // The register's own total row, as it would be downloaded.
  const register = await getSalaryRegister(companyId, m, y);
  // Split each line on commas outside quotes (a name may hold a comma).
  const cells = (line) => {
    const out = [];
    let cur = '';
    let quoted = false;
    for (const ch of line) {
      if (ch === '"') quoted = !quoted;
      else if (ch === ',' && !quoted) {
        out.push(cur);
        cur = '';
      } else cur += ch;
    }
    out.push(cur);
    return out;
  };
  const lines = register.csv.trim().split('\r\n').map(cells);
  const col = lines[0].indexOf('Net payable');
  const totalRow = lines.find((l) => l[1] === 'Total');
  const registerTotal = totalRow && col >= 0 ? toPaise(totalRow[col]) : 0;
  // The bank file, and the payslips it couldn't include.
  const bank = await require('./payrollPayment.service').getBankFile(companyId, m, y);
  const leftOutIds = new Set((bank.skipped || []).map((s) => String(s.employeeId)));
  const leftOut = rows.filter(({ slip }) => leftOutIds.has(String(slip.employee_id))).reduce((s, { slip }) => s + netPayablePaise(slip), 0);
  const journal = await getJournal(companyId, m, y);
  const salaryPayable = toPaise(journal.entries.find((e) => e.account === 'Salary payable')?.credit || 0);
  const issues = [];
  if (registerTotal !== payslips) issues.push('The salary register\'s total isn\'t the payslips\' net payable.');
  if (toPaise(bank.total) + leftOut !== payslips) issues.push('The bank file (with what it left out) isn\'t the payslips\' net payable.');
  if (salaryPayable !== payslips) issues.push('The journal\'s salary payable isn\'t the payslips\' net payable.');
  if (!journal.balanced) issues.push('The journal doesn\'t balance.');
  // Rounding each net payable to the rupee leaves under ₹0.50 a payslip; more
  // means a payslip's stored total doesn't add up to its own lines.
  if (toPaise(journal.roundingOff) > rows.length * 50) {
    issues.push(`The journal needed ₹${journal.roundingOff} of rounding — some payslip's total doesn't add up to its lines.`);
  }
  return {
    month: m,
    year: y,
    payslips: rows.length,
    totals: {
      payslips: toRupees(payslips),
      register: toRupees(registerTotal),
      bankFile: bank.total,
      bankLeftOut: toRupees(leftOut),
      journalSalaryPayable: toRupees(salaryPayable),
    },
    journalBalanced: journal.balanced,
    agree: issues.length === 0,
    issues,
  };
};

module.exports = {
  getSalaryRegister, getJournal, getStateRegister, getReconciliation,
};
