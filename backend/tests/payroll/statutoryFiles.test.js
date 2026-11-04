/**
 * EPF ECR and ESI files from published payslips. The payslips are made by the
 * real calculation (computePayslip); the database is a stand-in returning the
 * rows in global.__mockTables (filters not applied). Read-only.
 */
// Never read backend/.env (the live database's keys) in a test.
jest.mock('dotenv', () => ({ config: () => ({ parsed: {} }) }));
jest.mock('../../src/config/supabase', () => {
  const builder = (table) => {
    const q = {};
    for (const m of ['select', 'eq', 'in', 'order', 'range', 'gte', 'lte']) q[m] = () => q;
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
const { getEcrFile, getEsiFile } = require('../../src/services/statutoryFiles.service');

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
    id,
    employee_id: employeeId,
    company_id: 'c1',
    month: 10,
    year: 2026,
    payslip_status: 'PUBLISHED',
    gross_salary: out.gross_salary,
    pf_deduction: out.pf_deduction,
    unpaid_leave_days: out.unpaid_leave_days,
    breakdown_json: out.breakdown_json,
  };
};

beforeAll(() => {
  global.__mockTables = {
    payroll: [
      // The report's Example 1: ₹40,000, 2 of 22 days absent → gross 36,364, PF 2,400 on 20,000
      published('p1', 'e1', { basic: 22000, hra: 8800, special: 9200 }, { workingDays: 22, absent: 2 }),
      // ₹18,000 a month, full month: ESI covered (0.75% = 135); PF 12% of 9,000 = 1,080
      published('p2', 'e2', { basic: 9000, hra: 3600, special: 5400 }, { workingDays: 22 }),
      // No UAN / ESIC number recorded
      published('p3', 'e3', { basic: 9000, hra: 3600, special: 5400 }, { workingDays: 22 }),
    ],
    employees: [
      { id: 'e1', first_name: 'Asha', last_name: 'Rao', employee_code: 'E1', salary_details: { statutory_ids: { uan: '100200300400' } } },
      { id: 'e2', first_name: 'Ravi', last_name: 'K#~#X', employee_code: 'E2', salary_details: { statutory_ids: { uan: '100200300401', esic_ip: '3100123456' } } },
      { id: 'e3', first_name: 'No', last_name: 'Ids', employee_code: 'E3', salary_details: {} },
    ],
  };
});
afterAll(() => { delete global.__mockTables; });

test('EPF ECR: one #~# line per member, whole rupees', async () => {
  const f = await getEcrFile('c1', 10, 2026);
  expect(f.filename).toBe('ecr-2026-10.txt');
  expect(f.text.trim().split('\r\n')).toEqual([
    // UAN, name, gross, EPF wages, EPS wages, EDLI wages, EE 12%, EPS 8.33%, ER EPF 3.67%, NCP days, refund
    '100200300400#~#ASHA RAO#~#36364#~#20000#~#20000#~#20000#~#2400#~#1666#~#734#~#2#~#0',
    // 9,000: EE 1,080; EPS 8.33% = 749.70 → 750; ER EPF 1,080 − 750 = 330
    '100200300401#~#RAVI K X#~#18000#~#9000#~#9000#~#9000#~#1080#~#750#~#330#~#0#~#0',
  ]);
  expect(f.totals).toEqual({ employeePf: 3480, eps: 2416, epfEmployer: 1064 });
  expect(f.skipped).toEqual([{ employeeId: 'e3', name: 'No Ids', reason: 'No UAN recorded' }]);
});

test('ESI: covered members only, with their ESIC number', async () => {
  const f = await getEsiFile('c1', 10, 2026);
  const lines = f.csv.trim().split('\r\n');
  expect(lines[0]).toBe('IP Number,IP Name,No of Days for which wages paid/payable during the month,Total Monthly Wages,Reason Code for Zero workings days,Last Working Day');
  // Example 1's ₹40,000 is above ₹21,000 → not covered, so not listed
  // 31 calendar days paid for in October (not the 22 working days)
  expect(lines.slice(1)).toEqual(['3100123456,Ravi K#~#X,31,18000,,']);
  expect(f.members).toBe(1);
  expect(f.totalWages).toBe(18000);
  expect(f.skipped).toEqual([{ employeeId: 'e3', name: 'No Ids', reason: 'No ESIC number recorded' }]);
});

test('month and year are checked', async () => {
  await expect(getEcrFile('c1', 0, 2026)).rejects.toThrow(/month and year/);
  await expect(getEsiFile('c1', 10, 1999)).rejects.toThrow(/month and year/);
});
