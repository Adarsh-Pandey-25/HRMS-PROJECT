/**
 * One-time pay and recoveries on the payslip (pure): paid as entered, PF only
 * on arrears of wages, ESI only on items flagged for it, PT on the whole
 * month's gross, and income tax by the difference method. Every figure was
 * worked out by hand first. October 2026, Bengaluru (Karnataka PT).
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

const ctxWith = (extra = {}, rules = {}) => ({
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
  rules: normalizePayrollRules(rules),
  workWeek: normalizeWorkWeek(null),
  leaveFirst: false,
  components: [],
  ...extra,
});
const R = (rupees) => Math.round(rupees * 100);
const item = (id, kind, name, rupees, flags = {}) => ({
  id, kind, name, earning: !['notice_recovery', 'other_deduction'].includes(kind), amount: R(rupees), taxable: true, pfWage: false, esiWage: false, ...flags,
});
const slip = (ctx, salary, summary, oneTime, extra = {}) => payroll.computePayslip(ctx, {
  employee: { id: 'e1', gender: 'male', salary_details: salary }, summary, records: [], month: 10, year: 2026, oneTime, ...extra,
});
const example1 = { basic: 22000, hra: 8800, special: 9200 };

test('arrears of ₹3,000 on Example 1: PF on 20,000 + 3,000 = 23,000 → 2,760; net 39,364 − 2,960 = 36,404', () => {
  const out = slip(ctxWith(), example1, { workingDays: 22, absent: 2 }, [item('a1', 'arrears', 'Arrears', 3000, { pfWage: true, esiWage: true })]);
  expect(out.gross_salary).toBe(39364);
  expect(out.pf_deduction).toBe(2760);
  expect(out.net_salary).toBe(36404);
  expect(out.breakdown_json.earnings).toContainEqual({ name: 'Arrears', amount: 3000, rate: 0 });
  expect(out.breakdown_json.config).toMatchObject({ one_time_pay: 3000, pf_wages: 23000 });
  // The CTC is the regular month's: one-time pay isn't part of it.
  expect(out.breakdown_json.config.ctc_monthly).toBe(43917.69);
  expect(out.breakdown_json.config.blockers).toEqual([]);
});

test('a ₹10,000 bonus to someone on ESI: no PF or ESI on it, PT on the whole ₹28,000', () => {
  // Basic 15,000 + HRA 3,000: PF 12% × 15,000 = 1,800; ESI 0.75% × 18,000 = 135 (employer 585);
  // PT: 28,000 ≥ 25,000 → 200. Net 28,000 − 2,135 = 25,865.
  const out = slip(ctxWith(), { basic: 15000, hra: 3000 }, { workingDays: 22 }, [item('b1', 'bonus', 'Bonus', 10000)]);
  expect(out.gross_salary).toBe(28000);
  expect(out.pf_deduction).toBe(1800);
  expect(out.esi_deduction).toBe(135);
  expect(out.breakdown_json.employer_contributions).toContainEqual({ name: 'Employer ESI', amount: 585 });
  expect(out.professional_tax).toBe(200);
  expect(out.net_salary).toBe(25865);
});

test('income tax by the difference method: the tax a ₹2,00,000 bonus adds is deducted in full that month', () => {
  // ₹1,00,000 a month, April–September paid (6L), nothing deducted. Without the bonus: 12L − 75,000 =
  // 11,25,000 → 52,500 → rebate → nil. With it: 13,25,000 → 20,000 + 40,000 + 15% × 1,25,000 (18,750) =
  // 78,750 + cess 3,150 = 81,900. So October's TDS is 0 + 81,900 (spread over 6 months it would be 13,650).
  const ctx = ctxWith({ tdsPolicy: 'projected' }, { dayRateBasis: 'calendar' });
  const history = { tax: { salaryPaid: R(600000), tdsPaid: 0, ptPaid: 0, earlierDrafts: [], monthsCounted: [] } };
  const out = slip(ctx, { basic: 100000 }, {}, [item('b1', 'bonus', 'Bonus', 200000)], { history });
  expect(out.tds).toBe(81900);
  expect(out.breakdown_json.config.tax).toMatchObject({
    one_time: 200000, one_time_tax: 81900, annual_tax: 81900, annual_tax_regular: 0, tds_regular: 0, taxable_income: 1325000,
  });
  // An item marked not taxable adds no tax.
  const exempt = slip(ctx, { basic: 100000 }, {}, [item('g1', 'gratuity', 'Gratuity', 200000, { taxable: false })], { history });
  expect(exempt.tds).toBe(0);
});

test('a recovery comes off after every other deduction, never more than the pay left', () => {
  // Example 1: net 33,764 before the recovery of 5,000 → 28,764.
  const out = slip(ctxWith(), example1, { workingDays: 22, absent: 2 }, [item('n1', 'notice_recovery', 'Notice period not served', 5000)]);
  expect(out.net_salary).toBe(28764);
  expect(out.breakdown_json.deductions).toContainEqual({ name: 'Notice period not served', amount: 5000 });
  expect(out.breakdown_json.config.one_time).toEqual([{
    id: 'n1', kind: 'notice_recovery', name: 'Notice period not served', amount: 5000, due: 5000, earning: false,
  }]);
  // ₹40,000 to recover from 33,764 left: 33,764 taken, 6,236 to recover another way.
  const big = slip(ctxWith(), example1, { workingDays: 22, absent: 2 }, [item('n2', 'notice_recovery', 'Notice period not served', 40000)]);
  expect(big.net_salary).toBe(0);
  expect(big.breakdown_json.config.warnings.find((w) => w.code === 'recovery_short').message).toMatch(/₹6,236/);
  expect(big.breakdown_json.config.blockers).toEqual([]);
});

test('in a month split by a raise, loss of pay is the same with or without one-time pay', () => {
  const ctx = ctxWith({}, { dayRateBasis: 'calendar' });
  const revisions = [{
    effective_date: '2026-10-16', status: 'applied', previous_salary: example1, new_salary: { basic: 27500, hra: 11000, special: 11500 },
  }];
  const summary = { absent: 1, absentDates: ['2026-10-20'] };
  const salary = { basic: 27500, hra: 11000, special: 11500 };
  const without = slip(ctx, salary, summary, [], { revisions });
  const withBonus = slip(ctx, salary, summary, [item('b1', 'bonus', 'Bonus', 5000)], { revisions });
  expect(withBonus.breakdown_json.config.lop_amount).toBe(without.breakdown_json.config.lop_amount);
  expect(withBonus.gross_salary).toBe(without.gross_salary + 5000);
});
