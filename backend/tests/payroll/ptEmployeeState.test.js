/**
 * Professional Tax by the state each employee works in (Payroll setup), for
 * companies with staff in more than one state — the company's own state is
 * the default. October 2026; the company is in Karnataka.
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

// West Bengal (no SpaxSync table), as the company entered it: nil to ₹10,000; ₹110; ₹130 from ₹15,001;
// ₹150 from ₹25,001; ₹200 from ₹40,001.
const westBengal = [
  { from: 0, amount: 0 }, { from: 10001, amount: 110 }, { from: 15001, amount: 130 }, { from: 25001, amount: 150 }, { from: 40001, amount: 200 },
];
const ctxFor = (config = {}) => ({
  companyId: 'c1',
  workingDaysSetting: 26,
  payrollConfig: {},
  ...payroll.resolvePayrollPolicy({
    pf_policy: 'statutory_ceiling', esi_applicable: true, tds_policy: 'fixed_per_employee', pt_state: 'Karnataka', pt_state_set: true, ...config,
  }),
  rules: normalizePayrollRules({}),
  workWeek: normalizeWorkWeek(null),
  leaveFirst: false,
  components: [],
});
const slip = (ctx, salary, gender = 'male') => payroll.computePayslip(ctx, {
  employee: { id: 'e1', gender, salary_details: salary }, summary: { workingDays: 22 }, records: [], month: 10, year: 2026,
});
const cfg = (out) => out.breakdown_json.config;

test('an employee in Maharashtra pays Maharashtra PT: ₹200 on ₹20,000 (Karnataka: nil under ₹25,000)', () => {
  const ctx = ctxFor();
  expect(slip(ctx, { basic: 20000 }).professional_tax).toBe(0);
  const out = slip(ctx, { basic: 20000, pt_state: 'Maharashtra' });
  expect(out.professional_tax).toBe(200);
  expect(cfg(out)).toMatchObject({ pt_state: 'Maharashtra', pt_state_own: true, pt_kind: 'slab' });
  // Women in Maharashtra are exempt up to ₹25,000.
  expect(slip(ctx, { basic: 20000, pt_state: 'Maharashtra' }, 'female').professional_tax).toBe(0);
});

test('an employee in Tamil Nadu: the half-year rule — ₹40,000 a month → ₹1,250 for the half-year, ₹208 in October', () => {
  const out = slip(ctxFor(), { basic: 40000, pt_state: 'Tamil Nadu' });
  expect(cfg(out)).toMatchObject({ pt_state: 'Tamil Nadu', pt_half_year_amount: 1250 });
  expect(out.professional_tax).toBe(208);
});

test('a state with no SpaxSync table: the slabs the company entered for it (₹150 on ₹30,000), else blocked', () => {
  const withSlabs = slip(ctxFor({ pt_other_states: [{ state: 'West Bengal', slabs: westBengal }] }), { basic: 30000, pt_state: 'West Bengal' });
  expect(withSlabs.professional_tax).toBe(150);
  expect(cfg(withSlabs).blockers).toEqual([]);
  // The company's own single amount (for Karnataka) never applies to another state.
  const without = slip(ctxFor({ pt_manual_amount: 200 }), { basic: 30000, pt_state: 'West Bengal' });
  expect(cfg(without).blockers.map((b) => b.code)).toContain('pt_amount_missing');
  expect(cfg(without).blockers.find((b) => b.code === 'pt_amount_missing').message).toMatch(/West Bengal/);
});

test('an unconfirmed company Karnataka blocks only those who pay PT there', () => {
  const ctx = ctxFor({ pt_state_set: false });
  expect(cfg(slip(ctx, { basic: 30000 })).blockers.map((b) => b.code)).toContain('pt_state_unconfirmed');
  expect(cfg(slip(ctx, { basic: 30000, pt_state: 'Maharashtra' })).blockers).toEqual([]);
});

test('an employee whose state is the company\'s own is treated as the company', () => {
  const out = slip(ctxFor(), { basic: 30000, pt_state: 'karnataka' });
  expect(out.professional_tax).toBe(200);
  expect(cfg(out).pt_state_own).toBe(false);
  // Not a state at all: ignored (the company's state).
  expect(cfg(slip(ctxFor(), { basic: 30000, pt_state: 'Atlantis' })).pt_state).toBe('Karnataka');
});

describe('Labour Welfare Fund, as the company entered it for each state', () => {
  const lwf = [
    { state: 'Karnataka', employee: 20, employer: 40, months: [12] },
    { state: 'Maharashtra', employee: 25, employer: 75, months: [6, 12] },
    { state: 'Atlantis', employee: 5, employer: 5, months: [1] }, // not a state: ignored
    { state: 'Goa', employee: 10, employer: 20, months: [] }, // no months: ignored
  ];
  const inMonth = (ctx, salary, month) => payroll.computePayslip(ctx, {
    employee: { id: 'e1', gender: 'male', salary_details: salary }, summary: { workingDays: 22 }, records: [], month, year: 2026,
  });

  test('Karnataka in December: ₹20 from the employee, ₹40 from the employer; nothing in October', () => {
    // ₹30,000: PF 12% × 25,000 = 3,000; PT 200; LWF 20 → net 26,780.
    const ctx = ctxFor({ lwf_states: lwf });
    const dec = inMonth(ctx, { basic: 30000 }, 12);
    expect(dec.breakdown_json.deductions).toContainEqual({ name: 'Labour Welfare Fund', amount: 20 });
    expect(dec.breakdown_json.employer_contributions).toContainEqual({ name: 'Employer LWF', amount: 40 });
    expect(dec.net_salary).toBe(26780);
    expect(cfg(dec).lwf).toEqual({ state: 'Karnataka', employee: 20, employer: 40 });
    // CTC spreads the employer's ₹40 a year over the months: 40 ÷ 12 = 3.33.
    expect(cfg(dec).ctc_provisions.lwf).toBe(3.33);
    const oct = inMonth(ctx, { basic: 30000 }, 10);
    expect(cfg(oct).lwf).toBeNull();
    expect(oct.net_salary).toBe(26800);
  });

  test('the state the employee works in decides: Maharashtra, June and December (₹25 + ₹75; CTC 75 × 2 ÷ 12 = 12.50)', () => {
    const out = inMonth(ctxFor({ lwf_states: lwf }), { basic: 30000, pt_state: 'Maharashtra' }, 6);
    expect(cfg(out).lwf).toEqual({ state: 'Maharashtra', employee: 25, employer: 75 });
    expect(cfg(out).ctc_provisions.lwf).toBe(12.5);
  });

  test('entries that make no sense are ignored; no entry, no LWF', () => {
    expect(payroll.resolvePayrollPolicy({ lwf_states: lwf }).lwfStates).toEqual({
      Karnataka: { employee: 2000, employer: 4000, months: [12] },
      Maharashtra: { employee: 2500, employer: 7500, months: [6, 12] },
    });
    expect(cfg(inMonth(ctxFor(), { basic: 30000 }, 12)).lwf).toBeNull();
  });
});

test('LWF to the paisa, as the state sets it: Delhi ₹0.75 and ₹2.25 in June and December (review, 3 Nov)', () => {
  const ctx = ctxFor({ pt_state: 'Delhi', lwf_states: [{ state: 'Delhi', employee: 0.75, employer: 2.25, months: [6, 12] }] });
  const out = payroll.computePayslip(ctx, {
    employee: { id: 'e1', gender: 'male', salary_details: { basic: 30000 } }, summary: { workingDays: 22 }, records: [], month: 12, year: 2026,
  });
  expect(out.breakdown_json.deductions).toContainEqual({ name: 'Labour Welfare Fund', amount: 0.75 });
  expect(out.breakdown_json.employer_contributions).toContainEqual({ name: 'Employer LWF', amount: 2.25 });
  // CTC: 2.25 × 2 ÷ 12 = 0.375 → 0.38
  expect(out.breakdown_json.config.ctc_provisions.lwf).toBe(0.38);
});
