/**
 * The payroll service around the engine: salary records, attendance
 * summaries and company settings in; payslip rows out. No database — the
 * functions tested here are pure; the modules that would send anything
 * (email, storage) are stand-ins.
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

const moment = require('moment-timezone');
const payroll = require('../../src/services/payroll.service');
const { normalizePayrollRules } = require('../../src/utils/payrollRules');
const { normalizeWorkWeek } = require('../../src/utils/workWeek');

const ctxWith = (overrides = {}) => ({
  companyId: 'c1',
  workingDaysSetting: overrides.workingDaysSetting || 26,
  payrollConfig: overrides.payrollConfig || {},
  pfPolicy: 'statutory_ceiling',
  esiApplicable: true,
  tdsPolicy: 'fixed_per_employee',
  ptState: 'Karnataka',
  ptManualAmount: null,
  choicesMade: { pf: true, esi: true, tds: true },
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

describe('payslip rows from salary records (October 2026, Bengaluru)', () => {
  test("the report's Example 1 end to end: ₹40,000, 2 of 22 days absent", () => {
    const out = slip(ctxWith(), { basic: 22000, hra: 8800, special: 9200 }, { workingDays: 22, absent: 2 });
    expect(out.breakdown_json.earnings).toEqual([
      { name: 'Basic', amount: 20000, rate: 22000 },
      { name: 'HRA', amount: 8000, rate: 8800 },
      { name: 'Special Allowance', amount: 8364, rate: 9200 },
    ]);
    expect(out.gross_salary).toBe(36364);
    expect(ded(out, 'PF')).toBe(2400);
    expect(ded(out, 'Professional Tax')).toBe(200);
    expect(ded(out, 'LOP')).toBe(0); // no separate LOP line any more
    expect(out.total_deductions).toBe(2600);
    expect(out.net_salary).toBe(33764);
    // Pay lost to the 2 days, for reports: 40,000 − 36,364
    expect(out.lop_deduction).toBe(3636);
    expect(out.unpaid_leave_days).toBe(2);
    expect(out.breakdown_json.config.paid_days).toBe(20);
    expect(out.breakdown_json.employer_contributions).toEqual([
      { name: 'Employer PF — pension (EPS)', amount: 1666 },
      { name: 'Employer PF — EPF', amount: 734 },
      { name: 'EDLI', amount: 100 },
      { name: 'EPF admin charges', amount: 100 },
    ]);
    // CTC per month = full pay 40,000 + employer PF on 22,000: EPS 1,833 (1,832.60) + EPF 807 + EDLI 110 + admin 110 = 42,860
    // + the gratuity provision 22,000 × 15 ÷ (26 × 12) = 1,057.69 = 43,917.69 (no bonus: wages above ₹21,000)
    expect(out.breakdown_json.config.ctc_monthly).toBe(43917.69);
    expect(out.breakdown_json.config.ctc_provisions).toEqual({ gratuity: 1057.69, bonus: 0, lwf: 0 });
    expect(out.breakdown_json.config.blockers).toEqual([]);
  });

  test("Spaxads' settings carry over: PF 0% → not applicable, ESI 0% → not covered, Rajasthan → no PT", () => {
    const policy = payroll.resolvePayrollPolicy(
      { pt_state: 'Rajasthan', tds_mode: 'auto', auto_process: false, run_date: 28 },
      { pfRate: 0, esiPercent: 0 },
    );
    expect(policy).toMatchObject({ pfPolicy: 'not_applicable', esiApplicable: false, tdsPolicy: 'fixed_per_employee', ptState: 'Rajasthan', ptManualAmount: null });
    // Fixed 30-day basis; late rule: 2 free, then every late = ½ day. 5 lates → 3 × ½ = 1.5 days
    const ctx = ctxWith({
      workingDaysSetting: 30,
      rules: { dayRateBasis: 'fixed', late: { enabled: true, freeLates: 2, every: 1, penalty: 'half' } },
      ctx: policy,
    });
    const out = slip(ctx, { basic: 30000 }, { workingDays: 22, late: 5 });
    // 30,000 × (30 − 1.5)/30 = 28,500, and nothing deducted
    expect(out.gross_salary).toBe(28500);
    expect(out.total_deductions).toBe(0);
    expect(out.net_salary).toBe(28500);
    expect(out.breakdown_json.employer_contributions).toEqual([]);
  });

  test('a mid-month joiner on a fixed 30-day basis gets exactly their share of the month', () => {
    const ctx = ctxWith({ workingDaysSetting: 30, rules: { dayRateBasis: 'fixed' }, ctx: { pfPolicy: 'not_applicable', esiApplicable: false, ptState: 'Delhi' } });
    const out = slip(ctx, { basic: 30000 }, { workingDays: 22, joinedOn: '2026-10-16' });
    // Employed 16 of 31 days: 30,000 × 16/31 = 15,483.87 → 15,484
    expect(out.gross_salary).toBe(15484);
    expect(out.breakdown_json.config.paid_days).toBe(15.48);
    expect(out.breakdown_json.config.not_employed_days).toBe(15);
  });

  test('a leaver on the calendar basis is paid to the last working day', () => {
    const ctx = ctxWith({ rules: { dayRateBasis: 'calendar' }, ctx: { pfPolicy: 'not_applicable', esiApplicable: false, ptState: 'Delhi' } });
    const out = slip(ctx, { basic: 31000 }, { workingDays: 22, leftOn: '2026-10-20' });
    // Employed 1–20 October: 31,000 × 20/31 = 20,000
    expect(out.gross_salary).toBe(20000);
    expect(out.breakdown_json.config.left_on).toBe('2026-10-20');
  });

  test('a leaver on the working-day basis: the working days after leaving are unpaid', () => {
    const ctx = ctxWith({ ctx: { pfPolicy: 'not_applicable', esiApplicable: false, ptState: 'Delhi' } });
    const out = slip(ctx, { basic: 22000 }, { workingDays: 22, afterLeaving: 8, leftOn: '2026-10-20' });
    // 22,000 × 14/22 = 14,000
    expect(out.gross_salary).toBe(14000);
  });

  test('a preview (no attendance summary) is a full month, whatever the joining date', () => {
    const out = slip(ctxWith({ ctx: { ptState: 'Delhi' } }), { basic: 20000 }, {});
    expect(out.gross_salary).toBe(20000);
  });

  test('PT not set up → the slip is marked blocked, not guessed', () => {
    const noState = slip(ctxWith({ ctx: { ptState: '' } }), { basic: 30000 }, { workingDays: 22 });
    expect(noState.breakdown_json.config.blockers.map((b) => b.code)).toEqual(['pt_state_missing']);
    const noTable = slip(ctxWith({ ctx: { ptState: 'Gujarat' } }), { basic: 30000 }, { workingDays: 22 });
    expect(noTable.breakdown_json.config.blockers.map((b) => b.code)).toEqual(['pt_amount_missing']);
    const manual = slip(ctxWith({ ctx: { ptState: 'Gujarat', ptManualAmount: 20000 } }), { basic: 30000 }, { workingDays: 22 });
    expect(ded(manual, 'Professional Tax')).toBe(200);
  });

  test('the old 8% TDS estimate in salary_details.tds is never charged', () => {
    const out = slip(ctxWith(), { basic: 40000, tds: 3200 }, { workingDays: 22 });
    expect(ded(out, 'TDS')).toBe(0);
    const typed = slip(ctxWith(), { basic: 40000, tds_mode: 'fixed', tds_fixed: 1500 }, { workingDays: 22 });
    expect(ded(typed, 'TDS')).toBe(1500);
  });

  test('company allowances and deductions keep working, in whole rupees', () => {
    const ctx = ctxWith({
      payrollConfig: {
        custom_payroll_options: [
          { id: 'shift', name: 'Shift Allowance', kind: 'allowance', value_type: 'percent', value: 10, base: 'basic' },
          { id: 'canteen', name: 'Canteen', kind: 'deduction', value_type: 'fixed', value: 450.4 },
        ],
      },
      ctx: { ptState: 'Delhi', pfPolicy: 'not_applicable' },
    });
    const out = slip(ctx, { basic: 20000 }, { workingDays: 22, absent: 1 });
    // Shift allowance 10% × 20,000 = 2,000 a month; 21/22 paid: Basic 19,090.91 → 19,091; Shift 1,909.09 → 1,909
    expect(out.breakdown_json.earnings).toEqual([
      { name: 'Basic', amount: 19091, rate: 20000 },
      { name: 'HRA', amount: 0, rate: 0 },
      { name: 'Shift Allowance', amount: 1909, rate: 2000 },
    ]);
    // ESI coverage is judged on the contract pay, 22,000 (> 21,000) — not on the 21,000 earned → no ESI.
    // Canteen 450.40 → 450.
    expect(ded(out, 'ESI')).toBe(0);
    expect(ded(out, 'Canteen')).toBe(450);
    expect(out.net_salary).toBe(21000 - 450);
  });
});

describe('company policy from settings', () => {
  test('nothing saved: the legal ceiling for PF, ESI covered, TDS typed per employee', () => {
    expect(payroll.resolvePayrollPolicy({}, { pfRate: null, esiPercent: null })).toMatchObject({
      pfPolicy: 'statutory_ceiling', esiApplicable: true, tdsPolicy: 'fixed_per_employee', ptManualAmount: null,
    });
  });

  test('new choices win over old settings', () => {
    expect(payroll.resolvePayrollPolicy(
      { pf_policy: 'full_wages', esi_applicable: false, tds_policy: 'none', pt_manual_amount: 150 },
      { pfRate: 0, esiPercent: 0.75 },
    )).toMatchObject({ pfPolicy: 'full_wages', esiApplicable: false, tdsPolicy: 'none', ptManualAmount: 15000 });
  });

  test('"No PT" for a state is an amount of 0; a blank amount is "not set"', () => {
    expect(payroll.resolvePayrollPolicy({ pt_manual_amount: 0 }).ptManualAmount).toBe(0);
    expect(payroll.resolvePayrollPolicy({ pt_manual_amount: '' }).ptManualAmount).toBe(null);
    expect(payroll.resolvePayrollPolicy({ pt_manual_amount: -5 }).ptManualAmount).toBe(null);
  });
});

describe('who is in a month\'s payroll', () => {
  const inOct = (e) => payroll.employmentInMonth(e, 10, 2026);

  test('active staff are; someone joining after the month is not', () => {
    expect(inOct({ is_active: true, date_of_joining: '2024-01-01' })).toEqual({ employed: true, lastWorkingDay: null });
    expect(inOct({ is_active: true, date_of_joining: '2026-11-03' }).employed).toBe(false);
  });

  test('a leaver is, for the month they left, with their last working day', () => {
    expect(inOct({ is_active: false, last_working_day: '2026-10-20' })).toEqual({ employed: true, lastWorkingDay: '2026-10-20' });
    expect(inOct({ is_active: false, last_working_day: '2026-09-30' }).employed).toBe(false);
  });

  test('before the last-working-day column exists, the offboarding date stands in', () => {
    const e = { is_active: false, employment_status: 'offboarded', offboarded_at: '2026-10-21T10:30:00Z' };
    expect(inOct(e)).toEqual({ employed: true, lastWorkingDay: '2026-10-21' });
  });

  test('switched off without leaving (no last working day) — not paid, as before', () => {
    expect(inOct({ is_active: false }).employed).toBe(false);
  });

  test('someone serving notice (still active, last day in the month) is paid to that day', () => {
    expect(inOct({ is_active: true, last_working_day: '2026-10-15' })).toEqual({ employed: true, lastWorkingDay: '2026-10-15' });
  });
});

describe('a month is run only once it is over', () => {
  test('a past month has ended; this month and next have not', () => {
    const now = moment.tz('Asia/Kolkata');
    const last = now.clone().subtract(1, 'month');
    expect(payroll.monthHasEnded(last.month() + 1, last.year())).toBe(true);
    expect(payroll.monthHasEnded(now.month() + 1, now.year())).toBe(false);
    const next = now.clone().add(1, 'month');
    expect(payroll.monthHasEnded(next.month() + 1, next.year())).toBe(false);
  });
});
