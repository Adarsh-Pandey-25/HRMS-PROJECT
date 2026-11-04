/**
 * The payroll service, continued: the fixes from the independent review of
 * 2 Nov 2026, and TDS worked out from the tax slabs on real payslip rows.
 * No database — the modules that would send anything are stand-ins.
 * Expected rupee figures were worked out by hand first.
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

const ctxWith = (overrides = {}) => ({
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
  rules: normalizePayrollRules(overrides.rules || {}),
  workWeek: normalizeWorkWeek(null),
  leaveFirst: false,
  components: [],
  ...overrides.ctx,
});

const slip = (ctx, salary, summary = {}, extra = {}) => payroll.computePayslip(ctx, {
  employee: { id: 'e1', gender: 'male', salary_details: salary },
  summary,
  records: [],
  month: 10,
  year: 2026,
  ...extra,
});

const ded = (out, name) => out.breakdown_json.deductions.find((d) => d.name === name)?.amount ?? 0;
const forty = { basic: 22000, hra: 8800, special: 9200 };

describe('review fixes (independent review, 2 Nov 2026)', () => {
  test("ESI's ₹176 a day counts calendar days paid, whatever the day basis: ₹5,000 on 22 working days → no employee ESI", () => {
    // 5,000 ÷ 31 paid calendar days = 161.29 a day ≤ 176 → exempt; employer 3.25% × 5,000 = 162.50 → up 163
    const ctx = ctxWith({ rules: { dayRateBasis: 'working' } });
    const out = slip(ctx, { basic: 5000 }, { workingDays: 22 });
    expect(out.breakdown_json.config.esi_exempt).toBe(true);
    expect(out.esi_deduction).toBe(0);
    expect(out.breakdown_json.employer_contributions.find((e) => /ESI/.test(e.name))?.amount).toBe(163);
    // ₹5,500 is 177.42 a day → the employee pays 0.75% = 41.25 → up 42
    expect(slip(ctx, { basic: 5500 }, { workingDays: 22 }).esi_deduction).toBe(42);
    // 2 days absent out of 22 working days: 29 calendar days paid; earned 5,500 × 20/22 = 5,000 → 172.41 a day → exempt
    const absent = slip(ctx, { basic: 5500 }, { workingDays: 22, absent: 2 });
    expect(absent.gross_salary).toBe(5000);
    expect(absent.esi_deduction).toBe(0);
  });

  const chennai = ctxWith({ ctx: { ptState: 'Tamil Nadu' } });
  test("Tamil Nadu: a leaver's last slip settles the half-year — ₹40,000, leaving 30 Nov, October paid ₹208", () => {
    // Half-year income 40,000 + 40,000 = 80,000 → ₹1,250 slab; 1,250 − 208 = 1,042 now (not 208)
    const history = { pt: { grossBefore: 4000000, paidBefore: 20800, monthsLeft: 5 } };
    expect(slip(chennai, forty, { leftOn: '2026-11-30' }, { month: 11, history }).professional_tax).toBe(1042);
    // Staying on: 2,40,000 projected → 1,250; (1,250 − 208) ÷ 5 = 208.40 → 208
    expect(slip(chennai, forty, {}, { month: 11, history }).professional_tax).toBe(208);
  });

  test('Tamil Nadu previews assume the same pay all half-year: ₹208, not the one-month slab ₹425', () => {
    expect(slip(chennai, forty, {}, { month: 10 }).professional_tax).toBe(208); // 1,250 ÷ 6 = 208.33
    expect(slip(chennai, forty, {}, { month: 11 }).professional_tax).toBe(208); // (1,250 − 208) ÷ 5 = 208.40
    // Oct 208 · Nov 208 · Dec 834 ÷ 4 = 208.50 → 209 · Jan 625 ÷ 3 = 208.33 → 208 · Feb 417 ÷ 2 = 208.50 → 209 · Mar 1,250 − 1,042 = 208
    expect(slip(chennai, forty, {}, { month: 12 }).professional_tax).toBe(209);
    expect(slip(chennai, forty, {}, { month: 2 }).professional_tax).toBe(209);
    expect(slip(chennai, forty, {}, { month: 3 }).professional_tax).toBe(208);
  });

  test('a state without a SpaxSync table: the slabs the company entered, not one flat amount', () => {
    const slabs = [{ from: 10001, amount: 110 }, { from: 15001, amount: 130 }, { from: 25001, amount: 150 }, { from: 40001, amount: 200 }];
    const policy = payroll.resolvePayrollPolicy({ pt_state: 'West Bengal', pt_manual_slabs: slabs });
    const ctx = ctxWith({ ctx: { ...policy, ptManualAmount: 20000 } });
    const pt = (gross) => slip(ctx, { basic: gross }).professional_tax;
    expect(pt(9000)).toBe(0);
    expect(pt(10000)).toBe(0);
    expect(pt(10001)).toBe(110);
    expect(pt(30000)).toBe(150);
    expect(pt(50000)).toBe(200);
    expect(slip(ctx, { basic: 30000 }).breakdown_json.config.pt_company_slabs).toBe(true);
    // A state with its own table ignores them.
    const ka = ctxWith({ ctx: payroll.resolvePayrollPolicy({ pt_state: 'Karnataka', pt_state_set: true, pt_manual_slabs: slabs }) });
    expect(slip(ka, { basic: 30000 }).professional_tax).toBe(200);
    // Slabs that make no sense are not used.
    expect(payroll.resolvePayrollPolicy({ pt_manual_slabs: [{ from: 'x', amount: 1 }] }).ptManualSlabs).toBe(null);
    expect(payroll.resolvePayrollPolicy({ pt_manual_slabs: [{ from: 0, amount: 5000 }] }).ptManualSlabs).toBe(null);
    expect(payroll.resolvePayrollPolicy({ pt_manual_slabs: [{ from: 100, amount: 1 }, { from: 100, amount: 2 }] }).ptManualSlabs).toBe(null);
  });

  test('a Karnataka the old screen filled in must be confirmed before PT is charged', () => {
    const unconfirmed = ctxWith({ ctx: payroll.resolvePayrollPolicy({ pt_state: 'Karnataka' }) });
    expect(unconfirmed.ptStateUnconfirmed).toBe(true);
    expect(slip(unconfirmed, forty).breakdown_json.config.blockers.map((b) => b.code)).toContain('pt_state_unconfirmed');
    // Below Karnataka's ₹25,000 it charges nothing, but the real state might charge (Maharashtra: ₹200), so it blocks too.
    expect(slip(unconfirmed, { basic: 20000 }).breakdown_json.config.blockers.map((b) => b.code)).toContain('pt_state_unconfirmed');
    expect(payroll.resolvePayrollPolicy({ pt_state: 'Karnataka', pt_state_set: true }).ptStateUnconfirmed).toBe(false);
    expect(payroll.resolvePayrollPolicy({ pt_state: 'Rajasthan' }).ptStateUnconfirmed).toBe(false);
  });

  test('salary typed as text: "22,000" is ₹22,000; something that isn\'t an amount blocks the slip', () => {
    const text = slip(ctxWith(), { basic: '22,000', hra: '₹ 8,800', special: 9200 });
    expect(text.gross_salary).toBe(40000);
    expect(text.breakdown_json.config.blockers).toEqual([]);
    const bad = slip(ctxWith(), { basic: '22k', hra: -5, special: 9200 });
    const blocker = bad.breakdown_json.config.blockers.find((b) => b.code === 'salary_not_a_number');
    expect(blocker.message).toMatch(/^Basic, HRA /);
  });
});

describe('TDS worked out from the tax slabs (company policy "projected")', () => {
  const projected = ctxWith({ ctx: { tdsPolicy: 'projected' } });
  const twoLakh = { basic: 100000, hra: 40000, special: 60000 };
  const taxHistory = (h) => ({
    tax: {
      salaryPaid: 0, tdsPaid: 0, ptPaid: 0, earlierDrafts: [], ...h,
    },
  });

  test("the report's Example 2 on a payslip: ₹2 lakh a month in October → TDS ₹24,375", () => {
    // PF 12% × 25,000 = 3,000; PT ₹200; TDS (2,92,500 − 1,46,250) ÷ 6 = 24,375; net 2,00,000 − 27,575 = 1,72,425
    const out = slip(projected, twoLakh, {}, { history: taxHistory({ salaryPaid: 120000000, tdsPaid: 14625000 }) });
    expect(out.tds).toBe(24375);
    expect(ded(out, 'TDS')).toBe(24375);
    expect(out.net_salary).toBe(172425);
    expect(out.breakdown_json.config.tax).toMatchObject({
      tax_year: '2026-27', regime: 'new', applied: true, annual_tax: 292500, taxable_income: 2325000, tds_before: 146250, tds: 24375,
    });
  });

  test('a fixed amount set for the employee still wins; the projection is kept for information', () => {
    const history = taxHistory({ salaryPaid: 120000000, tdsPaid: 14625000 });
    const out = slip(projected, { ...twoLakh, tds_mode: 'fixed', tds_fixed: 1000 }, {}, { history });
    expect(out.tds).toBe(1000);
    expect(out.breakdown_json.config.tax).toMatchObject({ applied: false, tds: 24375 });
    expect(slip(projected, { ...twoLakh, tds_mode: 'none' }, {}, { history }).tds).toBe(0);
  });

  test("a leaver's last slip takes what tax is left, but never more than the pay left", () => {
    // Leaving 5 Oct, calendar basis: 5/31 of the month → Basic 16,129 + HRA 6,452 + Special 9,677 = 32,258;
    // PF 12% × 16,129 = 1,935; PT 200 → 30,123 left. Year: 24,00,000 + 32,258 − 75,000 = 23,57,258
    // → to ₹10: 23,57,260 → 2,89,315 + cess 11,572.60 = 3,00,887.60 → 3,00,890; nothing deducted before → limited to 30,123.
    const ctx = ctxWith({ rules: { dayRateBasis: 'calendar' }, ctx: { tdsPolicy: 'projected' } });
    const out = slip(ctx, twoLakh, { leftOn: '2026-10-05' }, { history: taxHistory({ salaryPaid: 240000000 }) });
    expect(out.gross_salary).toBe(32258);
    expect(out.pf_deduction).toBe(1935);
    expect(out.breakdown_json.config.tax).toMatchObject({
      months_left: 1, taxable_income: 2357260, annual_tax: 300890, tds_due: 300890, tds: 30123, shortfall: 270767,
    });
    expect(out.tds).toBe(30123);
    expect(out.net_salary).toBe(0);
    expect(out.breakdown_json.config.warnings.map((w) => w.code)).toContain('tds_capped');
    expect(out.breakdown_json.config.blockers).toEqual([]);
  });

  test('an earlier draft this tax year blocks the slip (its pay and TDS would be missed)', () => {
    const out = slip(projected, twoLakh, {}, { history: taxHistory({ earlierDrafts: [{ month: 9, year: 2026 }] }) });
    expect(out.breakdown_json.config.blockers.map((b) => b.code)).toEqual(['tds_earlier_draft']);
    expect(out.tds).toBe(0);
  });

  test('a sample salary with nothing to look back on: as if paid every month since April (₹1.5 lakh → ₹12,567 in October)', () => {
    const out = payroll.computePayslip(projected, {
      employee: { id: null, salary_details: { basic: 75000, hra: 30000, special: 45000 } }, summary: {}, records: [], month: 10, year: 2026,
    });
    expect(out.tds).toBe(12567);
    expect(out.breakdown_json.config.tax.assumed_full_year).toBe(true);
  });

  test("the old regime from the employee's tax profile, with PT and the allowed deductions", () => {
    // April, ₹1 lakh a month, Karnataka PT 200 a month and 300 in February (2,500 for the year), ₹2.5 lakh allowed:
    // 12,00,000 − 50,000 − 2,500 − 2,50,000 = 8,97,500 → 12,500 + 20% × 3,97,500 (79,500) = 92,000 + cess 3,680 = 95,680 ÷ 12 = 7,973.33 → 7,973
    const salary = {
      basic: 50000,
      hra: 20000,
      special: 30000,
      tax_profile: { years: { '2026-27': { regime: 'old', chapter8_deductions: 150000, hra_exemption: 100000 } } },
    };
    const out = payroll.computePayslip(projected, {
      employee: { id: 'e1', gender: 'male', date_of_birth: '1990-05-05', salary_details: salary },
      summary: {},
      records: [],
      month: 4,
      year: 2026,
      history: taxHistory({}),
    });
    expect(out.breakdown_json.config.tax).toMatchObject({ regime: 'old', professional_tax: 2500, taxable_income: 897500, annual_tax: 95680 });
    expect(out.tds).toBe(7973);
  });

  test('60 or older on the old regime: the senior slabs (nil to ₹3 lakh)', () => {
    // October, nothing paid before in SpaxSync: 6 × 2,00,000 = 12,00,000 − 50,000 − PT (Oct–Jan 4 × 200 + Feb 300 + Mar 200 = 1,300) = 11,48,700
    // 10,000 + 1,00,000 + 30% × 1,48,700 (44,610) = 1,54,610 + cess 6,184.40 = 1,60,794.40 → ₹10: 1,60,790 ÷ 6 = 26,798.33 → 26,798
    const salary = { ...twoLakh, tax_profile: { years: { '2026-27': { regime: 'old' } } } };
    const out = payroll.computePayslip(projected, {
      employee: { id: 'e1', date_of_birth: '1962-08-01', salary_details: salary }, summary: {}, records: [], month: 10, year: 2026, history: taxHistory({}),
    });
    expect(out.breakdown_json.config.blockers).toEqual([]);
    expect(out.breakdown_json.config.tax).toMatchObject({
      age_band: 'senior', professional_tax: 1300, taxable_income: 1148700, annual_tax: 160790, tds: 26798,
    });
    expect(out.tds).toBe(26798);
  });
});


describe('the salary in force during the month (salary revisions)', () => {
  // ₹40,000 before (22,000 / 8,800 / 9,200), ₹50,000 after (27,500 / 11,000 / 11,500)
  const before = { basic: 22000, hra: 8800, da: 0, special: 9200, transport: 0, medical: 0 };
  const after = { basic: 27500, hra: 11000, special: 11500 };
  const revision = (date) => ({ effective_date: date, status: 'applied', previous_salary: before, new_salary: after });
  const calendar = ctxWith({ rules: { dayRateBasis: 'calendar' } });

  test('a raise from 1 November, already applied when October is run, does not reach October', () => {
    const out = slip(calendar, after, {}, { revisions: [revision('2026-11-01')] });
    expect(out.gross_salary).toBe(40000);
    expect(out.pf_deduction).toBe(2640);
    expect(out.breakdown_json.config.salary_periods).toEqual([{ from: '2026-10-01', to: '2026-10-31', monthly_gross: 40000 }]);
    // Without the history it would have been paid at the new salary.
    expect(slip(calendar, after).gross_salary).toBe(50000);
    // A revision from 1 October is simply this month's salary.
    expect(slip(calendar, after, {}, { revisions: [revision('2026-10-01')] }).gross_salary).toBe(50000);
  });

  test('a raise from 16 October: 15 days at the old rate, 16 at the new (calendar days)', () => {
    // Basic 22,000 × 15/31 + 27,500 × 16/31 = 10,645.16 + 14,193.55 = 24,838.71 → 24,839
    // HRA 4,258.06 + 5,677.42 = 9,935.48 → 9,935; Special 4,451.61 + 5,935.48 = 10,387.10 → 10,387 → gross 45,161
    // PF 12% × 24,839 = 2,980.68 → 2,981; PT 200; net 41,980
    const out = slip(calendar, after, {}, { revisions: [revision('2026-10-16')] });
    expect(out.breakdown_json.earnings).toEqual([
      { name: 'Basic', amount: 24839, rate: 27500 },
      { name: 'HRA', amount: 9935, rate: 11000 },
      { name: 'Special Allowance', amount: 10387, rate: 11500 },
    ]);
    expect(out.gross_salary).toBe(45161);
    expect(out.pf_deduction).toBe(2981);
    expect(out.net_salary).toBe(41980);
    expect(out.breakdown_json.config.salary_periods).toEqual([
      { from: '2026-10-01', to: '2026-10-15', monthly_gross: 40000 },
      { from: '2026-10-16', to: '2026-10-31', monthly_gross: 50000 },
    ]);
    expect(out.breakdown_json.config.paid_days).toBe(31);
  });

  test('an absence costs the rate of the part it falls in', () => {
    // Absent 5 Oct (old rate) and 20 Oct (new rate): 14/31 at 22,000 + 15/31 at 27,500 = 9,935.48 + 13,306.45 = 23,241.93 → 23,242
    // HRA 3,974.19 + 5,322.58 = 9,296.77 → 9,297; Special 4,154.84 + 5,564.52 = 9,719.35 → 9,719 → gross 42,258; 29 days paid
    const out = slip(calendar, after, { absent: 2, absentDates: ['2026-10-05', '2026-10-20'] }, { revisions: [revision('2026-10-16')] });
    expect(out.basic_salary).toBe(23242);
    expect(out.gross_salary).toBe(42258);
    expect(out.breakdown_json.config.paid_days).toBe(29);
  });

  test('working days: 11 of 22 at each rate (Monday–Friday, revision from Friday 16 October)', () => {
    const working = ctxWith({ rules: { dayRateBasis: 'working' } });
    const out = slip(working, after, { workingDays: 22 }, { revisions: [revision('2026-10-16')] });
    // (22,000 + 27,500) ÷ 2 = 24,750; (8,800 + 11,000) ÷ 2 = 9,900; (9,200 + 11,500) ÷ 2 = 10,350
    expect([out.basic_salary, out.hra, out.special_allowance]).toEqual([24750, 9900, 10350]);
    expect(out.gross_salary).toBe(45000);
    expect(out.breakdown_json.config.paid_days).toBe(22);
  });

  test('a leaver with a raise in the month: paid to the last working day at each rate', () => {
    // Raise 16 Oct, leaving 20 Oct: 15/31 at 22,000 + 5/31 at 27,500 = 10,645.16 + 4,435.48 = 15,080.64 → 15,081
    const out = slip(calendar, after, { leftOn: '2026-10-20' }, { revisions: [revision('2026-10-16')] });
    expect(out.basic_salary).toBe(15081);
    expect(out.breakdown_json.config.paid_days).toBe(20);
  });

  test('two revisions: the earlier one only matters for the days before the later one', () => {
    // 1–9 Oct at ₹30,000 (Basic 30,000), 10–19 at ₹40,000 (before the second), 20–31 at today's ₹50,000 — Basic only for clarity
    const revs = [
      { effective_date: '2026-10-10', status: 'applied', previous_salary: { basic: 30000 }, new_salary: { basic: 40000 } },
      { effective_date: '2026-10-20', status: 'applied', previous_salary: { basic: 40000 }, new_salary: { basic: 50000 } },
      { effective_date: '2026-10-25', status: 'cancelled', previous_salary: { basic: 1 }, new_salary: { basic: 2 } },
    ];
    // 30,000 × 9/31 + 40,000 × 10/31 + 50,000 × 12/31 = 8,709.68 + 12,903.23 + 19,354.84 = 40,967.74 → 40,968
    const out = slip(calendar, { basic: 50000 }, {}, { revisions: revs });
    expect(out.basic_salary).toBe(40968);
    expect(out.breakdown_json.config.salary_periods.map((p) => p.monthly_gross)).toEqual([30000, 40000, 50000]);
  });
});


describe('salary history replayed in the order it was recorded (independent review, 3 Nov)', () => {
  const calendar = ctxWith({ rules: { dayRateBasis: 'calendar' } });
  // Basic only, for clarity. A raise to 50k from 1 Nov is applied on 1 Nov; on 3 Nov HR adds a
  // correction to 52k effective 16 Oct (its previous salary is the 50k in force when it was applied).
  const raise = { effective_date: '2026-11-01', status: 'applied', applied_at: '2026-11-01T00:05:00Z', previous_salary: { basic: 40000 }, new_salary: { basic: 50000 } };
  const correction = { effective_date: '2026-10-16', status: 'applied', applied_at: '2026-11-03T10:00:00Z', previous_salary: { basic: 50000 }, new_salary: { basic: 52000 } };

  test('a back-dated correction applied after a later raise: 40k to 15 Oct, then 52k', () => {
    // 40,000 × 15/31 + 52,000 × 16/31 = 19,354.84 + 26,838.71 = 46,193.55 → 46,194
    const out = slip(calendar, { basic: 52000 }, {}, { revisions: [raise, correction] });
    expect(out.basic_salary).toBe(46194);
    expect(out.breakdown_json.config.salary_periods.map((x) => x.monthly_gross)).toEqual([40000, 52000]);
    // The order the rows arrive in doesn't matter.
    expect(slip(calendar, { basic: 52000 }, {}, { revisions: [correction, raise] }).basic_salary).toBe(46194);
  });

  test('two revisions on the same date: the one applied last wins, whatever the row order', () => {
    const first = { effective_date: '2026-10-16', status: 'applied', applied_at: '2026-10-16T00:05:00Z', previous_salary: { basic: 40000 }, new_salary: { basic: 50000 } };
    const second = { effective_date: '2026-10-16', status: 'applied', applied_at: '2026-10-20T09:00:00Z', previous_salary: { basic: 50000 }, new_salary: { basic: 52000 } };
    expect(slip(calendar, { basic: 52000 }, {}, { revisions: [first, second] }).basic_salary).toBe(46194);
    expect(slip(calendar, { basic: 52000 }, {}, { revisions: [second, first] }).basic_salary).toBe(46194);
  });

  test('an Edit Employee change between two revisions is kept for the stretch it corrected', () => {
    // 1 Jun: 30k → 40k (a revision). In July HR corrects it to 45k in Edit Employee (no revision).
    // 16 Oct: 45k → 50k (a revision; its previous salary is the 45k then in force).
    // October: 45,000 × 15/31 + 50,000 × 16/31 = (6,75,000 + 8,00,000) ÷ 31 = 47,580.65 → 47,581 (not 40,000 for 1–15 Oct: 45,161)
    const full = (basic) => ({ basic, hra: 0, da: 0, special: 0, transport: 0, medical: 0 });
    const june = { effective_date: '2026-06-01', status: 'applied', applied_at: '2026-06-01T00:05:00Z', previous_salary: full(30000), new_salary: full(40000) };
    const october = { effective_date: '2026-10-16', status: 'applied', applied_at: '2026-10-16T00:05:00Z', previous_salary: full(45000), new_salary: full(50000) };
    const out = slip(calendar, full(50000), {}, { revisions: [june, october] });
    expect(out.breakdown_json.config.blockers).toEqual([]);
    expect(out.basic_salary).toBe(47581);
    expect(out.breakdown_json.config.salary_periods.map((x) => x.monthly_gross)).toEqual([45000, 50000]);
  });

  test('a revision record missing a salary figure blocks the slip instead of paying 0 for it', () => {
    const broken = { effective_date: '2026-11-01', status: 'applied', applied_at: '2026-11-01T00:05:00Z', previous_salary: { basic: null, hra: 8800, special: 9200 }, new_salary: { basic: 27500, hra: 11000, special: 11500 } };
    const out = slip(calendar, { basic: 27500, hra: 11000, special: 11500 }, {}, { revisions: [broken] });
    expect(out.breakdown_json.config.blockers.map((b) => b.code)).toContain('salary_history_incomplete');
    // It says which record and which amount: here Basic is empty (DA, Transport and Medical aren't there at all).
    const message = out.breakdown_json.config.blockers.find((b) => b.code === 'salary_history_incomplete').message;
    expect(message).toContain('previous salary recorded with the salary revision effective 2026-11-01');
    expect(message).toMatch(/no valid Basic, DA, Transport Allowance, Medical Allowance\./);
  });

  test('a revision record with the salary as text ("22,000") is read, not treated as missing', () => {
    const { pickComponents } = require('../../src/services/salaryRevision.service');
    expect(pickComponents({ basic: '22,000', hra: '₹ 8,800', special: 9200, da: '' })).toEqual({
      basic: 22000, hra: 8800, da: 0, special: 9200, transport: 0, medical: 0,
    });
    expect(pickComponents({ basic: 'abc' }).basic).toBeNull();
    const textual = { effective_date: '2026-10-16', status: 'applied', applied_at: '2026-10-16T00:05:00Z', previous_salary: pickComponents({ basic: '40,000' }), new_salary: pickComponents({ basic: 52000 }) };
    const out = slip(calendar, { basic: 52000 }, {}, { revisions: [textual] });
    expect(out.breakdown_json.config.blockers).toEqual([]);
    expect(out.basic_salary).toBe(46194);
  });
});


describe('split months and projections (independent reviews, 3 Nov)', () => {
  const before = { basic: 22000, hra: 8800, special: 9200 };
  const after = { basic: 27500, hra: 11000, special: 11500 };
  const revision = (date, prev = before, next = after) => ({ effective_date: date, status: 'applied', previous_salary: prev, new_salary: next });

  test('the late penalty still counts when the last part of the month has no working days', () => {
    // Working days; raise from Saturday 31 Oct (a weekly off); 3 lates = 1 day → 21 of 22 days, all at the old rate:
    // 22,000 × 21/22 = 21,000; 8,800 → 8,400; 9,200 → 8,781.82 → 8,782; gross 38,182 (as without the split)
    const ctx = ctxWith({ rules: { dayRateBasis: 'working', late: { enabled: true, freeLates: 0, every: 3, penalty: 'full' } } });
    const out = slip(ctx, after, { workingDays: 22, late: 3 }, { revisions: [revision('2026-10-31')] });
    expect([out.basic_salary, out.hra, out.special_allowance]).toEqual([21000, 8400, 8782]);
    expect(out.gross_salary).toBe(38182);
    expect(out.breakdown_json.config.paid_days).toBe(21);
  });

  test('a leaver whose raise came after they left: the late penalty comes off the days they worked', () => {
    // Calendar days, last day 20 Oct, raise from 25 Oct, 9 lates = 1.5 days → 18.5 of 31 days at the old rate:
    // 22,000 × 18.5/31 = 13,129.03; 8,800 → 5,251.61; 9,200 → 5,490.32 → 13,129 + 5,252 + 5,490 = 23,871
    const ctx = ctxWith({ rules: { dayRateBasis: 'calendar', late: { enabled: true, freeLates: 0, every: 3, penalty: 'half' } } });
    const out = slip(ctx, after, { leftOn: '2026-10-20', late: 9 }, { revisions: [revision('2026-10-25')] });
    expect(out.gross_salary).toBe(23871);
    expect(out.breakdown_json.config.paid_days).toBe(18.5);
  });

  test('absences a short last part can\'t take come off the part before (fixed 26-day basis)', () => {
    // Leaving Fri 30 Oct, raise from Mon 26 Oct, absent 26–30 Oct: the same paid share as without the split,
    // (2·26·31 − 2·26·1 − 10·31) ÷ (2·26·31) = 1,250/1,612 = 20.16 days, all at the old rate → 17,060 + 6,824 + 7,134 = 31,018
    const ctx = ctxWith({ rules: { dayRateBasis: 'fixed' }, ctx: { workingDaysSetting: 26 } });
    const absentDates = ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30'];
    const out = slip(ctx, after, { leftOn: '2026-10-30', absent: 5, absentDates }, { revisions: [revision('2026-10-26')] });
    expect(out.gross_salary).toBe(31018);
    expect(out.breakdown_json.config.paid_days).toBe(20.16);
  });

  test('ESI coverage in the month of a raise past ₹21,000 is judged on the salary when the month began', () => {
    // Basic 20,000 → 25,000 from 16 Oct: 9,677.42 + 12,903.23 = 22,580.65 → 22,581; covered (20,000 ≤ 21,000):
    // employee 0.75% = 169.36 → up 170; employer 3.25% = 733.88 → up 734
    const ctx = ctxWith({ rules: { dayRateBasis: 'calendar' } });
    const out = slip(ctx, { basic: 25000 }, {}, { revisions: [revision('2026-10-16', { basic: 20000 }, { basic: 25000 })] });
    expect(out.gross_salary).toBe(22581);
    expect(out.breakdown_json.config.esi_eligible).toBe(true);
    expect(out.esi_deduction).toBe(170);
    expect(out.breakdown_json.employer_contributions.find((e) => /ESI/.test(e.name)).amount).toBe(734);
  });

  test('an allowance a raise removed is still listed for the days it was paid', () => {
    // Transport 1,600 → 0 (moved into Special) from 16 Oct: Transport 1,600 × 15/31 = 774.19 → 774;
    // Special 7,600 × 15/31 + 9,200 × 16/31 = 3,677.42 + 4,748.39 = 8,425.81 → 8,426; lines add up to 40,000
    const ctx = ctxWith({ rules: { dayRateBasis: 'calendar' } });
    const was = { basic: 22000, hra: 8800, special: 7600, transport: 1600 };
    const now = { basic: 22000, hra: 8800, special: 9200, transport: 0 };
    const out = slip(ctx, now, {}, { revisions: [revision('2026-10-16', was, now)] });
    expect(out.breakdown_json.earnings.find((e) => e.name === 'Transport Allowance')).toMatchObject({ amount: 774 });
    expect(out.breakdown_json.earnings.reduce((s, e) => s + e.amount, 0)).toBe(out.gross_salary);
    expect(out.gross_salary).toBe(40000);
  });

  test('overtime is paid at the rate in force on the day it was worked', () => {
    // ₹31,000 → ₹62,000 from 16 Oct (Basic only), 10 hours on 5 Oct at 2×, 9-hour shift, calendar days:
    // 31,000 ÷ 31 ÷ 9 × 2 × 10 = 2,222.22 → 2,222 (not 4,444 at the new rate); Basic 15,000 + 32,000 = 47,000
    const ctx = ctxWith({ rules: { dayRateBasis: 'calendar', overtime: { mode: 'pay', multiplier: 2, base: 'gross', minMinutes: 0, monthlyCapHours: 0 } } });
    const records = [{ check_in_time: '2026-10-05T03:30:00.000Z', check_out_time: '2026-10-05T23:30:00.000Z', checkout_status: 'finalized', overtime_hours: 10 }];
    const out = slip(ctx, { basic: 62000 }, { expectedHours: 9 }, { revisions: [revision('2026-10-16', { basic: 31000 }, { basic: 62000 })], records });
    expect(out.overtime_pay).toBe(2222);
    expect(out.gross_salary).toBe(49222);
  });

  test('a split month with no unpaid days shows no loss of pay', () => {
    const ctx = ctxWith({ rules: { dayRateBasis: 'calendar' } });
    const out = slip(ctx, after, {}, { revisions: [revision('2026-10-16')] });
    expect(out.lop_deduction).toBe(0);
    expect(out.breakdown_json.config.lop_amount).toBe(0);
    // One day absent on 20 Oct costs a day at the new rate: 50,000 ÷ 31 = 1,612.90 (to the rupee per part: 27,500/31 + 11,000/31 + 11,500/31)
    const absent = slip(ctx, after, { absent: 1, absentDates: ['2026-10-20'] }, { revisions: [revision('2026-10-16')] });
    expect(absent.breakdown_json.config.lop_amount).toBe(45161 - absent.gross_salary);
  });

  test('an absence a one-day part can\'t take comes off the part before it (fixed 26-day basis)', () => {
    // Basic 26,000 to 15 Oct, 31,000 on 16 Oct, 36,000 from 17 Oct; absent on the 16th. Fixed 26-day basis, over 2 × 26 × 31 = 1,612:
    // the parts hold 15 × 52 = 780, 52 and 780; a day absent is 62 — the 16th's part takes 52, the 10 left come off 1–15 Oct.
    // (26,000 × 770 + 36,000 × 780) ÷ 1,612 = 29,838.71 → 29,839 (off 17–31 Oct instead it would be 29,777)
    const ctx = ctxWith({ rules: { dayRateBasis: 'fixed' } });
    const b = (basic) => ({ basic, hra: 0, da: 0, special: 0, transport: 0, medical: 0 });
    const out = slip(ctx, b(36000), { absent: 1, absentDates: ['2026-10-16'] }, {
      revisions: [revision('2026-10-16', b(26000), b(31000)), revision('2026-10-17', b(31000), b(36000))],
    });
    expect(out.breakdown_json.config.blockers).toEqual([]);
    expect(out.basic_salary).toBe(29839);
  });

  test('Tamil Nadu: the earlier-draft check is only for someone who pays PT', () => {
    const chennai = ctxWith({ ctx: { ptState: 'Tamil Nadu' } });
    const out = slip(chennai, { ...before, pt_applicable: false }, {}, {
      month: 11, history: { pt: { grossBefore: 0, paidBefore: 0, monthsLeft: 5 }, ptEarlierDrafts: [{ month: 10, year: 2026 }] },
    });
    expect(out.breakdown_json.config.blockers.map((x) => x.code)).not.toContain('pt_earlier_draft');
    expect(out.professional_tax).toBe(0);
  });

  test('Tamil Nadu: an earlier draft in the half-year blocks the slip', () => {
    const chennai = ctxWith({ ctx: { ptState: 'Tamil Nadu' } });
    const out = slip(chennai, before, {}, {
      month: 11, history: { pt: { grossBefore: 0, paidBefore: 0, monthsLeft: 5 }, ptEarlierDrafts: [{ month: 10, year: 2026 }] },
    });
    expect(out.breakdown_json.config.blockers.map((b) => b.code)).toContain('pt_earlier_draft');
  });

  const projected = ctxWith({ rules: { dayRateBasis: 'calendar' }, ctx: { tdsPolicy: 'projected' } });
  // later: months of 2026 after this one already published (a month generated late).
  const paidBefore = (lakhs, tds = 0, later = []) => ({
    tax: {
      salaryPaid: lakhs * 100000_00, tdsPaid: tds * 100, ptPaid: 0, earlierDrafts: [], monthsCounted: later.map((month) => ({ month, year: 2026 })),
    },
  });

  test('TDS in the month of a raise projects the coming months at the new salary', () => {
    // ₹1L → ₹2L Basic from 16 Oct; April–September ₹6L paid, nothing deducted:
    // October 48,387.10 + 1,03,225.81 = 1,51,612.90 → 1,51,613; + 5 × 2,00,000 → 17,51,613 − 75,000 = 16,76,613 → ₹10: 16,76,610
    // 1,20,000 + 20% × 76,610 (15,322) = 1,35,322 + cess 5,412.88 = 1,40,734.88 → 1,40,730 ÷ 6 = 23,455
    const out = slip(projected, { basic: 200000 }, {}, {
      revisions: [revision('2026-10-16', { basic: 100000 }, { basic: 200000 })], history: paidBefore(6),
    });
    expect(out.breakdown_json.config.tax).toMatchObject({ future_monthly: 200000, taxable_income: 1676610, annual_tax: 140730 });
    expect(out.tds).toBe(23455);
  });

  test('TDS: a raise from 1 November already counts for the months after October', () => {
    // October at ₹1L (the old salary), the 5 months to come at ₹2L: 6L + 1L + 10L = 17L − 75,000 = 16,25,000
    // → 1,20,000 + 20% × 25,000 = 1,25,000 + cess 5,000 = 1,30,000 ÷ 6 = 21,666.67 → 21,667
    const out = slip(projected, { basic: 200000 }, {}, {
      revisions: [revision('2026-11-01', { basic: 100000 }, { basic: 200000 })], history: paidBefore(6),
    });
    expect(out.gross_salary).toBe(100000);
    expect(out.tds).toBe(21667);
  });

  test('TDS for a month generated late counts the later months already published, and doesn\'t project them again', () => {
    // August, after September and October were published: 12L paid (Apr–Jul, Sep, Oct) with 1,46,250 deducted;
    // + August 2L + Nov–Mar 5 × 2L = 24L → 2,92,500 − 1,46,250 = 1,46,250 ÷ 6 = 24,375
    const out = slip(projected, { basic: 200000 }, {}, { month: 8, history: paidBefore(12, 146250, [9, 10]) });
    expect(out.breakdown_json.config.tax).toMatchObject({ projected_salary: 2400000, months_left: 6 });
    expect(out.tds).toBe(24375);
  });

  test('TDS for a month generated late, for someone leaving: the leaving month still counts only in part', () => {
    // August, after September and October were published; last working day 15 December.
    // Still to come: November, and December 15/31: 2,00,000 × 15 ÷ 31 = 96,774.19
    // 12L paid + August 2L + November 2L + 96,774.19 = 16,96,774.19 − 75,000 = 16,21,774.19 → ₹10: 16,21,770
    // 20,000 + 40,000 + 60,000 + 20% × 21,770 (4,354) = 1,24,354 + cess 4,974.16 = 1,29,328.16 → 1,29,330
    // − 1,00,000 deducted = 29,330 ÷ 3 = 9,776.67 → 9,777 (counting all of December it would be 16,933)
    const leaver = (extra) => payroll.computePayslip(projected, {
      employee: { id: 'e1', gender: 'male', salary_details: { basic: 200000 }, last_working_day: '2026-12-15' },
      summary: {},
      records: [],
      month: 8,
      year: 2026,
      ...extra,
    });
    const out = leaver({ history: paidBefore(12, 100000, [9, 10]) });
    expect(out.breakdown_json.config.tax).toMatchObject({
      months_left: 3, future_months: 2, leaving_month_share: { num: 15, den: 31 }, projected_salary: 1696774.19, taxable_income: 1621770, annual_tax: 129330,
    });
    expect(out.tds).toBe(9777);
  });

  test('TDS: Professional Tax still to come is worked out for the months actually to come', () => {
    // Karnataka, old regime: ₹200 a month, ₹300 in February. August generated after September and October:
    // the months to come are November to March, February among them — 4 × 200 + 300 = 1,100.
    const old = ctxWith({ rules: { dayRateBasis: 'calendar' }, ctx: { tdsPolicy: 'projected' } });
    const salary = { basic: 200000, tax_profile: { years: { '2026-27': { regime: 'old' } } } };
    const out = slip(old, salary, {}, { month: 8, history: paidBefore(12, 146250, [9, 10]) });
    // PT paid before 0 (stand-in) + August 200 + 1,100 to come.
    expect(out.breakdown_json.config.tax).toMatchObject({ regime: 'old', future_months: 5, professional_tax: 1300 });
  });
});

test('use casual leave first never spends it on a day the employee took as unpaid leave', () => {
  const ctx = ctxWith({ rules: { dayRateBasis: 'calendar' }, ctx: { leaveFirst: true } });
  // Absent 22 Oct (unplanned) and 23 Oct (approved unpaid leave): only the 22nd is covered.
  const out = slip(ctx, { basic: 31000 }, { absent: 2, absentDates: ['2026-10-22', '2026-10-23'], unpaidLeaveDates: ['2026-10-23'] }, { leaveAvailable: 5 });
  expect(out.breakdown_json.config.leave_cover).toMatchObject({ days: 1, absentDates: ['2026-10-22'] });
  expect(out.gross_salary).toBe(30000); // one day unpaid: 31,000 × 30/31
});

test('use casual leave first never spends it on an unpaid half day either', () => {
  const ctx = ctxWith({ rules: { dayRateBasis: 'calendar' }, ctx: { leaveFirst: true } });
  // Half days on 15 Oct (unplanned) and 16 Oct (approved unpaid half-day leave): only the 15th is covered.
  const out = slip(ctx, { basic: 31000 }, {
    payHalfDay: 2, payHalfDayDates: ['2026-10-15', '2026-10-16'], unpaidLeaveDates: ['2026-10-16'],
  }, { leaveAvailable: 5 });
  expect(out.breakdown_json.config.leave_cover).toMatchObject({ days: 0.5, halfDayDates: ['2026-10-15'] });
  expect(out.gross_salary).toBe(30500); // half a day unpaid: 31,000 × 30.5/31
});
