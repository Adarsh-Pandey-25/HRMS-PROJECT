/**
 * The 50% limit on a month's total deductions (Code on Wages, 2019 s.18;
 * Wages (Central) Rules r.13): statutory deductions are never reduced; loans
 * are reduced first, then one-time recoveries, then the company's own
 * deductions; a one-time recovery's rest goes on next month's payslip when
 * this one is published; a final settlement isn't held to the limit but is
 * flagged. The database is an in-memory stand-in (eq filters applied);
 * attendance, audit and background work are stand-ins. Nothing is sent.
 * Expected rupee figures were worked out by hand first.
 */
// Never read backend/.env (the live database's keys) in a test.
jest.mock('dotenv', () => ({ config: () => ({ parsed: {} }) }));
jest.mock('../../src/config/supabase', () => {
  const make = (table) => {
    const state = { filters: [], op: 'select', payload: null };
    const rows = () => global.__db[table] || [];
    const match = (r) => state.filters.every(([f, v]) => String(r[f]) === String(v));
    const run = () => {
      if (state.op === 'insert') {
        const list = Array.isArray(state.payload) ? state.payload : [state.payload];
        const made = list.map((p, i) => ({ id: `${table}-${rows().length + i + 1}`, status: 'active', created_at: new Date().toISOString(), ...p }));
        global.__db[table] = [...rows(), ...made];
        return { data: made, error: null };
      }
      if (state.op === 'update') {
        const hit = rows().filter(match);
        hit.forEach((r) => Object.assign(r, state.payload));
        return { data: hit, error: null };
      }
      return { data: rows().filter(match), error: null };
    };
    const q = {};
    for (const m of ['select', 'order', 'in', 'gte', 'lte', 'gt', 'lt', 'neq', 'limit', 'range', 'ilike', 'is', 'not', 'or']) q[m] = () => q;
    q.eq = (f, v) => { state.filters.push([f, v]); return q; };
    q.insert = (p) => { state.op = 'insert'; state.payload = p; return q; };
    q.update = (p) => { state.op = 'update'; state.payload = p; return q; };
    q.maybeSingle = () => {
      const r = run();
      return Promise.resolve({ data: r.data ? (r.data[0] ?? null) : null, error: r.error });
    };
    q.single = q.maybeSingle;
    q.then = (resolve, reject) => Promise.resolve(run()).then(resolve, reject);
    return q;
  };
  return { supabaseAdmin: { from: (t) => make(t), rpc: () => Promise.resolve({ data: null, error: null }) } };
});
jest.mock('../../src/services/attendance.service', () => ({
  // October 2026, last working day the 31st: every working day worked.
  getMonthlySummary: async () => ({ summary: { workingDays: 22, absent: 0, halfDay: 0, late: 0, leftOn: '2026-10-31' }, records: [] }),
}));
const quiet = () => new Proxy({}, { get: (_t, prop) => (prop === '__esModule' || prop === 'then' ? undefined : () => Promise.resolve()) });
jest.mock('../../src/services/email.service', () => quiet());
jest.mock('../../src/services/notification.service', () => quiet());
jest.mock('../../src/services/storage.service', () => ({
  uploadPayslip: async () => ({ path: 'x' }), getSignedUrl: async () => 'x', STORAGE_BUCKETS: { payslips: 'payslips' },
}));
jest.mock('../../src/services/auditLog.service', () => ({ logAudit: () => Promise.resolve(), auditFromRequest: () => {} }));
jest.mock('../../src/utils/background', () => ({ runInBackground: () => {} }));
jest.mock('../../src/utils/logger', () => new Proxy({}, {
  get: (_t, prop) => (prop === '__esModule' || prop === 'then' ? undefined : () => {}),
}));

const payroll = require('../../src/services/payroll.service');
const oneTimePay = require('../../src/services/oneTimePay.service');
const fnf = require('../../src/services/fullAndFinal.service');
const settingsService = require('../../src/services/settings.service');
const companyRules = require('../../src/payroll/companyRules');
const { applyDeductionCap } = require('../../src/payroll/deductionCap');
const { normalizePayrollRules } = require('../../src/utils/payrollRules');
const { normalizeWorkWeek } = require('../../src/utils/workWeek');
const { settingsKey } = require('../../src/utils/tenant');

const R = (rupees) => Math.round(rupees * 100);
// ₹20,000 a month, PF on Basic ₹12,000 = ₹1,440; no PT (switched off for them) and
// no ESI (off for the company), so the statutory deductions are PF alone.
const salary = {
  basic: 12000, hra: 4800, special: 3200, pt_applicable: false,
};
const ctxWith = (extra = {}) => ({
  companyId: 'c1',
  workingDaysSetting: 26,
  payrollConfig: {},
  pfPolicy: 'statutory_ceiling',
  esiApplicable: false,
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
  ...extra,
});
const slip = (ctx, { sd = salary, employee = {}, summary = {}, ...extra } = {}) => payroll.computePayslip(ctx, {
  employee: { id: 'e1', gender: 'male', salary_details: sd, ...employee },
  summary: { workingDays: 22, ...summary },
  records: [],
  month: 10,
  year: 2026,
  ...extra,
});
const loan = (id, rupees, kind = 'loan') => ({
  loanId: id, kind, name: kind === 'advance' ? 'Salary advance recovery' : 'Loan recovery', amount: R(rupees),
});
const recovery = (id, rupees, name = 'Notice period not served') => ({
  id, kind: 'notice_recovery', name, earning: false, amount: R(rupees), taxable: false, pfWage: false, esiWage: false,
});
const cfg = (out) => out.breakdown_json.config;
const codes = (list) => (list || []).map((w) => w.code);

describe('the company setting', () => {
  test('defaults: 50% of gross pay; 1–100% allowed (100 = no limit); gross or Labour Code wages', () => {
    expect(companyRules.resolveCompanyCalc(null).deductionCap).toEqual({ base: 'gross', percent: 50 });
    const n = (deductionCap) => companyRules.normalizeCompanyCalc({ deductionCap }).deductionCap;
    expect(n({ base: 'code_wages', percent: 40 })).toEqual({ base: 'code_wages', percent: 40 });
    expect(n({ base: 'net', percent: 0 })).toEqual({ base: null, percent: null });
    expect(n({ percent: 100 })).toEqual({ base: null, percent: 100 });
    expect(n({ percent: 101 })).toEqual({ base: null, percent: null });
    expect(companyRules.companyDeductionCap({ deductionCap: { percent: 100 } }).on).toBe(false);
    expect(companyRules.companyDeductionCap(null)).toMatchObject({ on: true, percent: 50, rate: { num: 50, den: 100 } });
  });

  test('the pure rule: statutory first, then the company\'s own, one-time recoveries, loans', () => {
    // Pay 20,000, limit 10,000, statutory 1,440 → 8,560 for the rest: own 1,000, recovery 5,000, loan 2,560 of 6,000.
    const r = applyDeductionCap({
      pay: R(20000),
      base: R(20000),
      rate: { num: 50, den: 100 },
      statutory: R(1440),
      configured: [{ key: 'c', name: 'Canteen', amount: R(1000) }],
      oneTime: [{ key: 'o', name: 'Notice', amount: R(5000) }],
      loans: [{ key: 'l', name: 'Loan', amount: R(6000) }],
    });
    expect(r).toMatchObject({ limit: R(10000), applies: true, total: R(10000), heldByLimit: R(3440), overLimit: 0 });
    expect([r.configured[0].amount, r.oneTime[0].amount, r.loans[0].amount]).toEqual([R(1000), R(5000), R(2560)]);
    expect(r.loans[0]).toMatchObject({ held: R(3440), reason: 'limit' });
  });
});

describe('a month\'s payslip', () => {
  test('a loan is reduced so the total is 50% of gross; the rest stays on the loan', () => {
    // Limit 50% × 20,000 = 10,000; PF 1,440 → the ₹12,000 instalment takes 8,560, 3,440 held back.
    const out = slip(ctxWith(), { loans: [loan('L1', 12000)] });
    expect(out.breakdown_json.deductions).toEqual([{ name: 'PF', amount: 1440 }, { name: 'Loan recovery', amount: 8560 }]);
    expect(out.total_deductions).toBe(10000);
    expect(out.net_salary).toBe(10000);
    expect(cfg(out).loans).toEqual([{
      loan_id: 'L1', kind: 'loan', name: 'Loan recovery', amount: 8560, due: 12000,
    }]);
    expect(cfg(out).deduction_cap).toMatchObject({
      base: 'gross', percent: 50, wages: 20000, limit: 10000, applied: true, final_pay: false, statutory: 1440, total: 10000, held_back: 3440, over_limit: 0,
    });
    expect(cfg(out).deduction_cap.lines).toEqual([{
      name: 'Loan recovery', due: 12000, taken: 8560, held_back: 3440, carried: 'loan',
    }]);
    expect(cfg(out).payslip_notes).toEqual(['Loan recovery reduced by ₹3,440 (50% deduction limit); the rest stays on the loan for the coming months.']);
    expect(codes(cfg(out).warnings)).toEqual(['deduction_cap']);
    expect(cfg(out).blockers).toEqual([]);
  });

  test('loans are reduced before one-time recoveries', () => {
    // 8,560 for the rest: the ₹5,000 recovery in full, the ₹6,000 instalment 3,560.
    const out = slip(ctxWith(), { loans: [loan('L1', 6000)], oneTime: [recovery('n1', 5000)] });
    expect(out.breakdown_json.deductions).toEqual([
      { name: 'PF', amount: 1440 }, { name: 'Notice period not served', amount: 5000 }, { name: 'Loan recovery', amount: 3560 },
    ]);
    expect(cfg(out).one_time).toEqual([{
      id: 'n1', kind: 'notice_recovery', name: 'Notice period not served', amount: 5000, due: 5000, earning: false,
    }]);
    expect(cfg(out).deduction_cap.held_back).toBe(2440);
  });

  test('statutory deductions alone over 50%: the loan and the company\'s own deduction take nothing', () => {
    // PF 1,440 + fixed TDS 9,000 = 10,440, above the 10,000 limit: never reduced, everything else held back.
    const ctx = ctxWith({ payrollConfig: { custom_payroll_options: [{ id: 'canteen', name: 'Canteen', kind: 'deduction', value_type: 'fixed', value: 1000 }] } });
    const out = slip(ctx, { sd: { ...salary, tds_mode: 'fixed', tds_fixed: 9000 }, loans: [loan('L1', 5000)] });
    expect(out.breakdown_json.deductions).toEqual([{ name: 'PF', amount: 1440 }, { name: 'TDS', amount: 9000 }]);
    expect(out.tds).toBe(9000);
    expect(out.total_deductions).toBe(10440);
    expect(out.net_salary).toBe(9560);
    expect(cfg(out).loans).toBeNull();
    expect(cfg(out).deduction_cap).toMatchObject({ limit: 10000, statutory: 10440, held_back: 6000 });
    expect(cfg(out).payslip_notes).toEqual([
      'Loan recovery reduced by ₹5,000 (50% deduction limit); the rest stays on the loan for the coming months.',
      'Canteen reduced by ₹1,000 (50% deduction limit); not carried forward.',
    ]);
    expect(cfg(out).blockers).toEqual([]);
  });

  test('on Labour Code wages: 50% of Basic ₹12,000 is ₹6,000, so the loan takes 4,560', () => {
    const out = slip(ctxWith({ calc: { deductionCap: { base: 'code_wages' } } }), { loans: [loan('L1', 12000)] });
    expect(cfg(out).deduction_cap).toMatchObject({ base: 'code_wages', wages: 12000, limit: 6000, held_back: 7440 });
    expect(cfg(out).loans[0]).toMatchObject({ amount: 4560, due: 12000 });
    expect(out.net_salary).toBe(14000);
  });

  test('100% switches the limit off: the loan takes what the pay allows, and the payslip records the departure from the law', () => {
    const out = slip(ctxWith({ calc: { deductionCap: { percent: 100 } } }), { loans: [loan('L1', 12000)] });
    expect(cfg(out).loans[0]).toMatchObject({ amount: 12000, due: 12000 });
    expect(out.total_deductions).toBe(13440);
    expect(cfg(out).deduction_cap).toMatchObject({ percent: 100, limit: null, applied: false, held_back: 0 });
    expect(cfg(out).payslip_notes).toBeNull();
    expect(cfg(out).company_values).toEqual([{
      key: 'deductionCap.percent', label: 'Limit on total deductions', law: '50% of wages', company: 'none',
    }]);
    expect(codes(cfg(out).warnings)).toEqual(['company_values']);
  });

  test('a final payslip is not held to the limit, but says so', () => {
    // Leaving 31 October: the ₹15,000 left on the loan is recovered in full; 16,440 is 6,440 over the 10,000 limit.
    const out = slip(ctxWith(), {
      employee: { last_working_day: '2026-10-31' }, summary: { leftOn: '2026-10-31' }, loans: [loan('L1', 15000)],
    });
    expect(cfg(out).loans[0]).toMatchObject({ amount: 15000, due: 15000 });
    expect(out.total_deductions).toBe(16440);
    expect(cfg(out).deduction_cap).toMatchObject({
      limit: 10000, applied: false, final_pay: true, held_back: 0, over_limit: 6440,
    });
    expect(cfg(out).payslip_notes).toEqual([
      'Deductions on this final payslip (₹16,440) are more than the 50% deduction limit (₹10,000). As a final settlement nothing can be carried to a later month, so they were not reduced.',
    ]);
    expect(cfg(out).warnings.find((w) => w.code === 'deduction_cap_final_pay').message).toMatch(/₹6,440 over the 50% deduction limit/);
  });
});

describe('a one-time recovery held back goes on next month\'s payslip', () => {
  beforeEach(() => {
    global.__db = { payroll: [], payroll_one_time_items: [] };
  });
  afterAll(() => { delete global.__db; });

  const publish = (out) => payroll.applyPublishEffects(
    { id: 'p-oct', employee_id: 'e1', month: 10, year: 2026, employee: { company_id: 'c1' }, breakdown_json: out.breakdown_json },
    { id: 'h1', company_id: 'c1' },
  );

  test('₹15,000 notice recovery: 8,560 in October, 6,440 carried to November and recovered there', async () => {
    const oct = slip(ctxWith(), { oneTime: [recovery('n1', 15000)] });
    expect(cfg(oct).one_time).toEqual([{
      id: 'n1', kind: 'notice_recovery', name: 'Notice period not served', amount: 8560, due: 15000, carry_forward: 6440, earning: false,
    }]);
    expect(cfg(oct).payslip_notes).toEqual(['Notice period not served reduced by ₹6,440 (50% deduction limit); carried to next month.']);

    const config = await publish(oct);
    const [carried] = global.__db.payroll_one_time_items;
    expect(carried).toMatchObject({
      company_id: 'c1',
      employee_id: 'e1',
      month: 11,
      year: 2026,
      kind: 'notice_recovery',
      name: 'Notice period not served (carried from Oct 2026)',
      amount: 6440,
      taxable: false,
      source: 'manual',
      created_by: null,
    });
    expect(carried.note).toMatch(/₹6,440 of "Notice period not served" \(item n1\) on the Oct 2026 payslip/);
    expect(config.one_time[0].carried_to).toEqual({
      item_id: carried.id, month: 11, year: 2026, amount: 6440,
    });
    expect(config.one_time_carried_at).toBeTruthy();

    // November: the carried item is an ordinary recovery, within that month's limit.
    const items = await oneTimePay.itemsDue('e1', 11, 2026);
    const nov = slip(ctxWith(), { month: 11, oneTime: items });
    expect(nov.breakdown_json.deductions).toContainEqual({ name: 'Notice period not served (carried from Oct 2026)', amount: 6440 });
    expect(cfg(nov).deduction_cap.held_back).toBe(0);
  });

  test('carried again, it keeps one "carried from" — and skips a month already published', async () => {
    global.__db.payroll.push({
      id: 'p-nov', company_id: 'c1', employee_id: 'e1', month: 11, year: 2026, payslip_status: 'PUBLISHED',
    });
    const oct = slip(ctxWith(), { oneTime: [recovery('n2', 12000, 'Other recovery (carried from Sep 2026)')] });
    await publish(oct);
    expect(global.__db.payroll_one_time_items[0]).toMatchObject({
      month: 12, year: 2026, name: 'Other recovery (carried from Oct 2026)', amount: 3440,
    });
  });
});

describe('the full and final screen', () => {
  const leaver = {
    id: 'e1',
    company_id: 'c1',
    is_active: false,
    employment_status: 'offboarded',
    gender: 'male',
    date_of_joining: '2019-06-01',
    last_working_day: '2026-10-31',
    salary_details: salary,
  };
  beforeEach(async () => {
    global.__db = {
      employees: [leaver],
      payroll: [],
      payroll_one_time_items: [],
      salary_revisions: [],
      reimbursements: [],
      payroll_components: [],
      leave_balances: [],
      system_settings: [{ key: settingsKey('c1', 'payroll_config'), value: { pt_state: 'Karnataka', pt_state_set: true, esi_applicable: false } }],
    };
    await settingsService.ensureCache(true);
  });
  afterAll(() => { delete global.__db; });

  test('warns when the final payslip\'s deductions would pass the limit (not reduced: a settlement)', async () => {
    // 60 days of notice not served: 60 × 20,000 ÷ 30 = 40,000 to recover — more than half the final pay.
    const p = await fnf.previewFullAndFinal({
      companyId: 'c1', employeeId: 'e1', inputs: { notice: { requiredDays: 60, servedDays: 0, action: 'recover' } },
    });
    expect(p.items.find((i) => i.code === 'NOTICE_RECOVERY')).toMatchObject({ amount: 40000 });
    expect(p.deductionCapWarning).toMatch(/^The final payslip's deductions \(₹41,440\) would be more than the 50% deduction limit/);
    expect(p.deductionCapWarning).toMatch(/isn't held to the limit/);
  });

  test('no warning when the settlement stays within it', async () => {
    const p = await fnf.previewFullAndFinal({ companyId: 'c1', employeeId: 'e1', inputs: { leaveDays: 5 } });
    expect(p.deductionCapWarning).toBeNull();
  });
});
