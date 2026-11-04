/**
 * The salary register and the accounting journal from published payslips
 * made by the real calculation. The database is a stand-in returning the
 * rows in global.__mockTables (filters not applied). Read-only.
 */
// Never read backend/.env (the live database's keys) in a test.
jest.mock('dotenv', () => ({ config: () => ({ parsed: {} }) }));
jest.mock('../../src/config/supabase', () => {
  const builder = (table) => {
    const q = {};
    for (const m of ['select', 'eq', 'in', 'order', 'range']) q[m] = () => q;
    q.then = (resolve, reject) => Promise.resolve({ data: global.__mockTables?.[table] || [], error: null }).then(resolve, reject);
    return q;
  };
  return { supabaseAdmin: { from: (t) => builder(t) } };
});
jest.mock('../../src/services/email.service', () => new Proxy({}, {
  get: (_t, prop) => (prop === '__esModule' || prop === 'then' ? undefined : () => Promise.resolve()),
}));
jest.mock('../../src/utils/logger', () => new Proxy({}, {
  get: (_t, prop) => (prop === '__esModule' || prop === 'then' ? undefined : () => {}),
}));

const payroll = require('../../src/services/payroll.service');
const { normalizePayrollRules } = require('../../src/utils/payrollRules');
const { normalizeWorkWeek } = require('../../src/utils/workWeek');
const { getSalaryRegister, getJournal } = require('../../src/services/payrollReports.service');

const ctx = {
  companyId: 'c1',
  workingDaysSetting: 26,
  payrollConfig: {},
  pfPolicy: 'statutory_ceiling',
  esiApplicable: true,
  tdsPolicy: 'fixed_per_employee',
  ptState: 'Karnataka',
  ptManualAmount: null,
  ptManualSlabs: null,
  ptStateUnconfirmed: false,
  choicesMade: {},
  rules: normalizePayrollRules({}),
  workWeek: normalizeWorkWeek(null),
  leaveFirst: false,
  components: [],
};

const published = (id, employeeId, salary, summary) => {
  const out = payroll.computePayslip(ctx, {
    employee: { id: employeeId, gender: 'male', salary_details: salary }, summary, records: [], month: 10, year: 2026,
  });
  return {
    id, employee_id: employeeId, company_id: 'c1', month: 10, year: 2026, payslip_status: 'PUBLISHED',
    gross_salary: out.gross_salary, total_deductions: out.total_deductions, net_salary: out.net_salary, breakdown_json: out.breakdown_json,
  };
};

const people = [
  { id: 'e1', first_name: 'Asha', last_name: 'Rao', employee_code: 'E1', department: 'Sales' },
  { id: 'e2', first_name: 'Ravi', last_name: 'K', employee_code: 'E2', department: 'Ops' },
];

beforeEach(() => {
  global.__mockTables = {
    payroll: [
      // Example 1: gross 36,364; PF 2,400; PT 200; net 33,764; employer EPS 1,666, EPF 734, EDLI 100, admin 100
      published('p1', 'e1', { basic: 22000, hra: 8800, special: 9200 }, { workingDays: 22, absent: 2 }),
      // ₹18,000: PF 1,080, ESI 135, PT nil; net 16,785; employer EPS 750, EPF 330, EDLI 45, admin 45, ESI 585
      published('p2', 'e2', { basic: 9000, hra: 3600, special: 5400 }, { workingDays: 22 }),
    ],
    employees: people,
  };
});
afterAll(() => { delete global.__mockTables; });

test('journal: expenses and payables for the month, and it balances', async () => {
  const j = await getJournal('c1', 10, 2026);
  const by = Object.fromEntries(j.entries.map((e) => [e.account, e.debit || -e.credit]));
  expect(by).toEqual({
    'Salaries — Basic': 29000,
    'Salaries — HRA': 11600,
    'Salaries — Special Allowance': 13764,
    'Employer PF contribution': 3770, // 2,600 + 750 + 330 + 45 + 45
    'Employer ESI contribution': 585,
    'PF payable': -7250, // employees 3,480 + employer 3,770
    'ESI payable': -720, // 135 + 585
    'Professional Tax payable': -200,
    'Salary payable': -50549, // 33,764 + 16,785
  });
  expect(j).toMatchObject({
    balanced: true, totalDebit: 58719, totalCredit: 58719, roundingOff: 0,
  });
  expect(j.csv.split('\r\n')[1]).toBe('2026-10-31,Salaries — Basic,29000.00,,Salaries for October 2026 (2 payslips)');
});

test('journal: paise from rounding the net payable go to "Rounding off"', async () => {
  global.__mockTables.payroll = [{
    id: 'p3',
    employee_id: 'e1',
    company_id: 'c1',
    month: 10,
    year: 2026,
    payslip_status: 'PUBLISHED',
    gross_salary: 1000,
    total_deductions: 0,
    net_salary: 1000,
    breakdown_json: {
      earnings: [{ name: 'Basic', amount: 1000 }],
      deductions: [],
      employer_contributions: [],
      totals: { net_pay: 1000, total_reimbursements: 123.45, net_payable: 1123 },
    },
  }];
  const j = await getJournal('c1', 10, 2026);
  expect(j.entries).toEqual([
    { account: 'Salaries — Basic', debit: 1000, credit: 0 },
    { account: 'Staff reimbursements', debit: 123.45, credit: 0 },
    { account: 'Salary payable', debit: 0, credit: 1123 },
    { account: 'Rounding off', debit: 0, credit: 0.45 },
  ]);
  expect(j.balanced).toBe(true);
});

test('salary register: one row per employee with every line, and a total row', async () => {
  const r = await getSalaryRegister('c1', 10, 2026);
  const lines = r.csv.trim().split('\r\n');
  expect(lines[0]).toBe('Employee code,Employee name,Department,Paid days,Basic,HRA,Special Allowance,Gross,PF,Professional Tax,ESI,Total deductions,Net pay,Reimbursements,Net payable,'
    + 'Employer PF — pension (EPS) (employer),Employer PF — EPF (employer),EDLI (employer),EPF admin charges (employer),Employer ESI (employer)');
  expect(lines[1]).toBe('E1,Asha Rao,Sales,20,20000.00,8000.00,8364.00,36364.00,2400.00,200.00,0.00,2600.00,33764.00,0.00,33764.00,1666.00,734.00,100.00,100.00,0.00');
  expect(lines[2]).toBe('E2,Ravi K,Ops,22,9000.00,3600.00,5400.00,18000.00,1080.00,0.00,135.00,1215.00,16785.00,0.00,16785.00,750.00,330.00,45.00,45.00,585.00');
  expect(lines[3]).toBe(',Total,,,29000.00,11600.00,13764.00,54364.00,3480.00,200.00,135.00,3815.00,50549.00,0.00,50549.00,2416.00,1064.00,145.00,145.00,585.00');
  expect(r.employees).toBe(2);
});

test('journal: LWF, loan instalments and recoveries go to their own accounts (review, 3 Nov)', async () => {
  // Example 1 in a month with Karnataka LWF (₹20 + ₹40), a ₹5,000 loan instalment and ₹1,000 notice not served:
  // deductions 2,400 + 200 + 20 + 1,000 + 5,000 = 8,620 → net 27,744.
  const withLwf = { ...ctx, lwfStates: { Karnataka: { employee: 2000, employer: 4000, months: [10] } } };
  const out = payroll.computePayslip(withLwf, {
    employee: { id: 'e1', gender: 'male', salary_details: { basic: 22000, hra: 8800, special: 9200 } },
    summary: { workingDays: 22, absent: 2 },
    records: [],
    month: 10,
    year: 2026,
    loans: [{ loanId: 'L1', kind: 'loan', name: 'Loan recovery', amount: 500000 }],
    oneTime: [{ id: 'n1', kind: 'notice_recovery', name: 'Notice period not served', earning: false, amount: 100000 }],
  });
  expect(out.net_salary).toBe(27744);
  global.__mockTables.payroll = [{
    id: 'p4', employee_id: 'e1', company_id: 'c1', month: 10, year: 2026, payslip_status: 'PUBLISHED',
    gross_salary: out.gross_salary, total_deductions: out.total_deductions, net_salary: out.net_salary, breakdown_json: out.breakdown_json,
  }];
  const j = await getJournal('c1', 10, 2026);
  const by = Object.fromEntries(j.entries.map((e) => [e.account, e.debit || -e.credit]));
  expect(by).toMatchObject({
    'Employer PF contribution': 2600,
    'Employer LWF contribution': 40,
    'PF payable': -5000,
    'LWF payable': -60,
    'Staff loans and advances': -5000,
    'Notice pay recovered': -1000,
    'Salary payable': -27744,
  });
  expect(j).toMatchObject({ balanced: true, totalDebit: 39004, totalCredit: 39004, roundingOff: 0 });
});

test('PT and LWF registers by state: who paid it, and a total per state', async () => {
  const { getStateRegister } = require('../../src/services/payrollReports.service');
  const pt = await getStateRegister('c1', 10, 2026, 'pt');
  expect(pt.csv.trim().split('\r\n')).toEqual([
    'State,Employee code,Employee name,Gross,Professional Tax',
    'Karnataka,E1,Asha Rao,36364.00,200.00', // E2 earns under ₹25,000: no PT, not listed
    'Karnataka,,Total,36364.00,200.00',
  ]);
  expect(pt).toMatchObject({ filename: 'professional-tax-register-2026-10.csv', employees: 1 });
  const lwf = await getStateRegister('c1', 10, 2026, 'lwf');
  expect(lwf.csv.trim()).toBe('State,Employee code,Employee name,Employee LWF,Employer LWF');
  await expect(getStateRegister('c1', 10, 2026, 'gst')).rejects.toThrow(/pt or lwf/);
});

test('reconciliation: payslips = salary register = bank file (+ left out) = journal, and it balances', async () => {
  const { getReconciliation } = require('../../src/services/payrollReports.service');
  const r = await getReconciliation('c1', 10, 2026);
  // Net payable 33,764 + 16,785 = 50,549; neither has bank details, so the bank file leaves both out.
  expect(r).toMatchObject({
    payslips: 2,
    totals: {
      payslips: 50549, register: 50549, bankFile: 0, bankLeftOut: 50549, journalSalaryPayable: 50549,
    },
    journalBalanced: true,
    agree: true,
    issues: [],
  });
});

test('reconciliation catches a payslip whose stored total doesn\'t add up to its lines', async () => {
  const { getReconciliation } = require('../../src/services/payrollReports.service');
  global.__mockTables.payroll[0].breakdown_json.totals.net_payable = 33000; // its lines make 33,764
  const r = await getReconciliation('c1', 10, 2026);
  expect(r.agree).toBe(false);
  expect(r.issues.join(' ')).toMatch(/₹764 of rounding/);
});
