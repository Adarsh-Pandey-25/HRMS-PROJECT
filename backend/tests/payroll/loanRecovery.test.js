/**
 * Loans and salary advances on the payslip: the instalment comes off after
 * every other deduction and never more than the pay left; the rest stays on
 * the loan. Pure — the instalments due are passed in as payroll looks them up.
 */
// Never read backend/.env (the live database's keys) in a test.
jest.mock('dotenv', () => ({ config: () => ({ parsed: {} }) }));
jest.mock('../../src/config/supabase', () => ({ supabaseAdmin: { from: () => { throw new Error('no database in these tests'); } } }));
jest.mock('../../src/services/email.service', () => new Proxy({}, {
  get: (_t, prop) => (prop === '__esModule' || prop === 'then' ? undefined : () => Promise.resolve()),
}));
jest.mock('../../src/services/storage.service', () => ({
  uploadPayslip: async () => ({ path: 'x' }), getSignedUrl: async () => 'x', STORAGE_BUCKETS: { payslips: 'payslips' },
}));
jest.mock('../../src/utils/logger', () => new Proxy({}, {
  get: (_t, prop) => (prop === '__esModule' || prop === 'then' ? undefined : () => {}),
}));

const payroll = require('../../src/services/payroll.service');
const { normalizePayrollRules } = require('../../src/utils/payrollRules');
const { normalizeWorkWeek } = require('../../src/utils/workWeek');

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
  choicesMade: { pf: true, esi: true, tds: true, pt: true },
  rules: normalizePayrollRules({}),
  workWeek: normalizeWorkWeek(null),
  leaveFirst: false,
  components: [],
};
const R = (rupees) => Math.round(rupees * 100);
const slip = (salary, summary, loans) => payroll.computePayslip(ctx, {
  employee: { id: 'e1', gender: 'male', salary_details: salary }, summary, records: [], month: 10, year: 2026, loans,
});
const loan = (id, rupees, kind = 'loan') => ({
  loanId: id, kind, name: kind === 'advance' ? 'Salary advance recovery' : 'Loan recovery', amount: R(rupees),
});

test('Example 1 with a ₹5,000 instalment: after PF and PT, net 36,364 − 7,600 = 28,764', () => {
  const out = slip({ basic: 22000, hra: 8800, special: 9200 }, { workingDays: 22, absent: 2 }, [loan('L1', 5000)]);
  expect(out.breakdown_json.deductions).toEqual([
    { name: 'PF', amount: 2400 }, { name: 'Professional Tax', amount: 200 }, { name: 'Loan recovery', amount: 5000 },
  ]);
  expect(out.total_deductions).toBe(7600);
  expect(out.net_salary).toBe(28764);
  expect(out.breakdown_json.config.loans).toEqual([{
    loan_id: 'L1', kind: 'loan', name: 'Loan recovery', amount: 5000, due: 5000,
  }]);
  expect(out.breakdown_json.config.blockers).toEqual([]);
});

test('never more than the pay left: the rest stays on the loan, with a warning', () => {
  // Basic ₹3,000, full month: PF 12% = 360; ESI covered but the employee share is nil (₹96.77 a day ≤ ₹176);
  // PT nil (under ₹25,000). Pay left 2,640: the ₹5,000 loan takes 2,640, the advance nothing.
  const out = slip({ basic: 3000 }, { workingDays: 22 }, [loan('L1', 5000), loan('A1', 1000, 'advance')]);
  expect(out.net_salary).toBe(0);
  expect(out.breakdown_json.config.loans).toEqual([{
    loan_id: 'L1', kind: 'loan', name: 'Loan recovery', amount: 2640, due: 5000,
  }]);
  expect(out.breakdown_json.config.warnings.find((w) => w.code === 'loan_short').message).toMatch(/₹3,360 of this month's loan instalment/);
  expect(out.breakdown_json.config.blockers).toEqual([]);
});

test('no loans: nothing changes', () => {
  const out = slip({ basic: 22000, hra: 8800, special: 9200 }, { workingDays: 22, absent: 2 }, []);
  expect(out.net_salary).toBe(33764);
  expect(out.breakdown_json.config.loans).toBeNull();
});
