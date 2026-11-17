/**
 * Professional Tax tables added or changed in November 2026 (research report,
 * topic 10): West Bengal's new slabs from 1 Oct 2026 (and the table before),
 * Odisha's repeal from 1 Apr 2026, Gujarat, Andhra Pradesh, Madhya Pradesh
 * (yearly slabs, a larger March), Kerala (half-yearly), the ₹2,500-a-year
 * limit of Art. 276, and how a company's own amounts sit beside the tables.
 * Every figure was worked out by hand first. The database is an in-memory
 * stand-in (eq filters applied); nothing is sent.
 */
// Never read backend/.env (the live database's keys) in a test.
jest.mock('dotenv', () => ({ config: () => ({ parsed: {} }) }));
jest.mock('../../src/config/supabase', () => {
  const make = (table) => {
    const state = { filters: [] };
    const run = () => ({ data: (global.__db[table] || []).filter((r) => state.filters.every(([f, v]) => String(r[f]) === String(v))), error: null });
    const q = {};
    for (const m of ['select', 'order', 'in', 'gte', 'lte', 'neq', 'limit', 'ilike', 'is', 'not', 'or']) q[m] = () => q;
    q.eq = (f, v) => { state.filters.push([f, v]); return q; };
    q.maybeSingle = () => Promise.resolve({ data: run().data[0] ?? null, error: null });
    q.single = q.maybeSingle;
    q.then = (resolve, reject) => Promise.resolve(run()).then(resolve, reject);
    return q;
  };
  return { supabaseAdmin: { from: (t) => make(t), rpc: () => Promise.resolve({ data: null, error: null }) } };
});
const quiet = () => new Proxy({}, { get: (_t, prop) => (prop === '__esModule' || prop === 'then' ? undefined : () => Promise.resolve()) });
jest.mock('../../src/services/email.service', () => quiet());
jest.mock('../../src/services/notification.service', () => quiet());
jest.mock('../../src/services/auditLog.service', () => ({ logAudit: () => Promise.resolve(), auditFromRequest: () => {} }));
jest.mock('../../src/services/storage.service', () => ({
  uploadPayslip: async () => ({ path: 'x' }), getSignedUrl: async () => 'x', STORAGE_BUCKETS: { payslips: 'payslips' },
}));
jest.mock('../../src/utils/logger', () => new Proxy({}, {
  get: (_t, prop) => (prop === '__esModule' || prop === 'then' ? undefined : () => {}),
}));

const { computePayslip, halfYearlyPt, steadyHalfYearPtHistory } = require('../../src/payroll/engine');
const statutory = require('../../src/payroll/statutory');
const payroll = require('../../src/services/payroll.service');
const settingsService = require('../../src/services/settings.service');
const { settingsKey } = require('../../src/utils/tenant');
const { normalizePayrollRules } = require('../../src/utils/payrollRules');
const { normalizeWorkWeek } = require('../../src/utils/workWeek');

const R = (rupees) => Math.round(rupees * 100);

/** The engine alone: one Basic of `monthly` rupees, PF/ESI/TDS off, the state's PT rule on the 28th of the month. */
const slipFor = (state, monthly, {
  year = 2026, month = 10, pt = {}, days = {}, ptHistory = null, ptPaidThisYear = 0, oneTime = [], gender = 'male',
} = {}) => {
  const date = `${year}-${String(month).padStart(2, '0')}-28`;
  const rule = statutory.ptRule(state, date);
  return computePayslip({
    period: { year, month },
    employee: { gender },
    components: [{ code: 'BASIC', name: 'Basic', monthly: R(monthly), pfWage: true }],
    days: { basisDays: 22, unpaidHalfDays: 0, ...days },
    overtime: { mode: 'off' },
    policy: {
      pf: 'not_applicable', esi: false, tds: 'none', pt: { kind: rule.kind, rule: rule.rule, stateName: rule.state?.name, ...pt },
    },
    setup: { pf: false, esi: false, pt: true, tdsMode: 'none', tdsFixed: 0, optouts: [] },
    customDeductions: [],
    rules: { epf: statutory.epfRule(date), esi: statutory.esiRule(date), overtime: statutory.overtimeRule(date) },
    ptHistory,
    ptPaidThisYear,
    oneTime,
  });
};
const ptOf = (state, monthly, opts) => slipFor(state, monthly, opts).pt.amount / 100;

describe('West Bengal', () => {
  test('from 1 Oct 2026: nil to ₹20,000; ₹100; ₹140; ₹170; ₹208 above ₹1,00,000', () => {
    const oct = (gross) => ptOf('West Bengal', gross, { month: 10 });
    expect(oct(20000)).toBe(0);
    expect(oct(20001)).toBe(100);
    expect(oct(30000)).toBe(100);
    expect(oct(30001)).toBe(140);
    expect(oct(50000)).toBe(140);
    expect(oct(50001)).toBe(170);
    expect(oct(100000)).toBe(170);
    expect(oct(100001)).toBe(208);
    // No February or March difference: 208 × 12 = 2,496, within ₹2,500.
    expect(ptOf('West Bengal', 150000, { year: 2027, month: 2 })).toBe(208);
    expect(ptOf('West Bengal', 150000, { year: 2027, month: 3 })).toBe(208);
    expect(statutory.ptRule('West Bengal', '2026-10-01').rule).toMatchObject({ id: 'PT-WB-2026-10', status: 'corroborated' });
  });

  test('up to 30 Sep 2026 the earlier table: nil to ₹10,000; ₹110; ₹130; ₹150; ₹200 above ₹40,000', () => {
    const sep = (gross) => ptOf('West Bengal', gross, { month: 9 });
    expect(sep(10000)).toBe(0);
    expect(sep(10001)).toBe(110);
    expect(sep(15000)).toBe(110);
    expect(sep(15001)).toBe(130);
    expect(sep(25000)).toBe(130);
    expect(sep(25001)).toBe(150);
    expect(sep(40000)).toBe(150);
    expect(sep(40001)).toBe(200);
    expect(statutory.ptRule('West Bengal', '2026-09-30').rule.id).toBe('PT-WB-2016-08');
  });

  test('September 2026 against October 2026, the same pay', () => {
    expect([ptOf('West Bengal', 20000, { month: 9 }), ptOf('West Bengal', 20000, { month: 10 })]).toEqual([130, 0]);
    expect([ptOf('West Bengal', 30000, { month: 9 }), ptOf('West Bengal', 30000, { month: 10 })]).toEqual([150, 100]);
    expect([ptOf('West Bengal', 150000, { month: 9 }), ptOf('West Bengal', 150000, { month: 10 })]).toEqual([200, 208]);
    // Before any SpaxSync table (before Aug 2016) the company still enters it.
    expect(statutory.ptRule('West Bengal', '2016-07-31').kind).toBe('missing');
  });
});

describe('Odisha', () => {
  test('no PT from April 2026: ₹0, the payslip not blocked, the repeal recorded as the rule', () => {
    const april = slipFor('Odisha', 50000, { month: 4 });
    expect(april.pt).toMatchObject({ kind: 'none', amount: 0 });
    expect(april.blockers).toEqual([]);
    expect(statutory.ptRule('Odisha', '2026-04-01')).toMatchObject({ kind: 'none', rule: { id: 'PT-OD-2026-04', basis: 'none' } });
    // A company's old single amount no longer applies.
    expect(ptOf('Odisha', 50000, { month: 4, pt: { manualAmount: R(200) } })).toBe(0);
    expect(ptOf('Odisha', 50000, { year: 2027, month: 2, pt: { manualAmount: R(200) } })).toBe(0);
  });

  test('up to March 2026 unchanged: the company enters the amount, or the payslip is blocked', () => {
    expect(statutory.ptRule('Odisha', '2026-03-31')).toMatchObject({ kind: 'manual', rule: null });
    const march = slipFor('Odisha', 50000, { month: 3 });
    expect(march.blockers.map((b) => b.code)).toEqual(['pt_amount_missing']);
    expect(ptOf('Odisha', 50000, { month: 3, pt: { manualAmount: R(200) } })).toBe(200);
  });
});

describe('Gujarat, Andhra Pradesh, Karnataka', () => {
  test('Gujarat: nil up to ₹12,000, ₹200 above (February too); before Apr 2022 not built in', () => {
    expect(ptOf('Gujarat', 12000)).toBe(0);
    expect(ptOf('Gujarat', 12001)).toBe(200);
    expect(ptOf('Gujarat', 90000, { year: 2027, month: 2 })).toBe(200);
    expect(statutory.ptRule('Gujarat', '2022-03-31').kind).toBe('missing');
  });

  test('Andhra Pradesh: as Telangana — nil to ₹15,000; ₹150 to ₹20,000; ₹200 above', () => {
    expect(ptOf('Andhra Pradesh', 15000)).toBe(0);
    expect(ptOf('Andhra Pradesh', 15001)).toBe(150);
    expect(ptOf('Andhra Pradesh', 20000)).toBe(150);
    expect(ptOf('Andhra Pradesh', 20001)).toBe(200);
    for (const gross of [9000, 15000, 15001, 18000, 20000, 20001, 75000]) {
      expect(ptOf('Andhra Pradesh', gross)).toBe(ptOf('Telangana', gross));
    }
  });

  test('Karnataka: ₹25,000 threshold from Apr 2023; ₹300 in February only from Apr 2025', () => {
    expect(ptOf('Karnataka', 24999, { year: 2024, month: 2 })).toBe(0);
    expect(ptOf('Karnataka', 25000, { year: 2024, month: 2 })).toBe(200);
    expect(ptOf('Karnataka', 25000, { year: 2026, month: 2 })).toBe(300);
    expect(statutory.ptRule('Karnataka', '2024-02-28').rule.source).toMatch(/2023/);
  });
});

describe('Madhya Pradesh (a year\'s salary = the month\'s contract pay × 12)', () => {
  const mp = (monthly, opts) => ptOf('Madhya Pradesh', monthly, opts);

  test('the slabs at their edges: ₹2,25,000 nil; ₹125; ₹166 (March ₹174); ₹208 (March ₹212)', () => {
    expect(mp(18750)).toBe(0); //     2,25,000
    expect(mp(18751)).toBe(125); //   2,25,012
    expect(mp(25000)).toBe(125); //   3,00,000
    expect(mp(25000, { year: 2027, month: 3 })).toBe(125); // no larger March in this slab
    expect(mp(25001)).toBe(166); //   3,00,012
    expect(mp(33333)).toBe(166); //   3,99,996
    expect(mp(33333, { year: 2027, month: 3 })).toBe(174);
    expect(mp(33334)).toBe(208); //   4,00,008
    expect(mp(33334, { year: 2027, month: 2 })).toBe(208); // February is an ordinary month here
    expect(mp(33334, { year: 2027, month: 3 })).toBe(212);
  });

  test('a full year comes to ₹1,500, ₹2,000 and ₹2,500 — never past the limit', () => {
    const year = (monthly) => {
      let paid = 0;
      for (const [y, m] of [[2026, 4], [2026, 5], [2026, 6], [2026, 7], [2026, 8], [2026, 9], [2026, 10], [2026, 11], [2026, 12], [2027, 1], [2027, 2], [2027, 3]]) {
        paid += slipFor('Madhya Pradesh', monthly, { year: y, month: m, ptPaidThisYear: paid }).pt.amount;
      }
      return paid / 100;
    };
    expect(year(20000)).toBe(1500); // 125 × 12
    expect(year(30000)).toBe(2000); // 166 × 11 + 174
    expect(year(40000)).toBe(2500); // 208 × 11 + 212
  });

  test('loss of pay and one-time pay don\'t move the slab', () => {
    // Half the month unpaid: earned ₹15,000, but the year's salary is still 30,000 × 12.
    expect(mp(30000, { days: { basisDays: 22, unpaidHalfDays: 22 } })).toBe(166);
    // A ₹1,00,000 bonus this month doesn't put a ₹20,000 earner in the top slab.
    expect(mp(20000, { oneTime: [{ code: 'ONE_TIME:b', name: 'Bonus', amount: R(100000) }] })).toBe(125);
  });

  test('March after PT paid elsewhere this year: stopped at what is left of ₹2,500', () => {
    // Moved from Maharashtra: ₹2,400 already deducted (200 × 10 + 300 + 100). MP's March ₹212 → ₹100.
    const out = slipFor('Madhya Pradesh', 40000, { year: 2027, month: 3, ptPaidThisYear: R(2400) });
    expect(out.pt).toMatchObject({ amount: R(100), capped: true });
    expect(out.warnings.map((w) => w.code)).toContain('pt_annual_cap');
  });
});

describe('Kerala (half-yearly, local bodies)', () => {
  const rule = statutory.ptRule('Kerala', '2026-10-28').rule;
  // The half-year's amount for a half-year's income (the last month of the half-year settles it all).
  const halfYear = (income) => halfYearlyPt(rule, R(income), R(income), { grossBefore: 0, paidBefore: 0, monthsLeft: 1 }).halfYearAmount / 100;

  test('the half-year bands from 1 Oct 2024', () => {
    expect(halfYear(11999)).toBe(0);
    expect(halfYear(12000)).toBe(320);
    expect(halfYear(17999)).toBe(320);
    expect(halfYear(18000)).toBe(450);
    expect(halfYear(29999)).toBe(450);
    expect(halfYear(30000)).toBe(600);
    expect(halfYear(44999)).toBe(600);
    expect(halfYear(45000)).toBe(750);
    expect(halfYear(99999)).toBe(750);
    expect(halfYear(100000)).toBe(1000);
    expect(halfYear(124999)).toBe(1000);
    expect(halfYear(125000)).toBe(1250);
    expect(rule).toMatchObject({ id: 'PT-KL-2024-10', basis: 'half_yearly', localBody: true });
    expect(rule.source).toMatch(/check yours/);
  });

  test('₹25,000 a month: ₹1,250 for the half-year, spread like Chennai — ₹208 in October, the six months exactly ₹1,250', () => {
    const october = slipFor('Kerala', 25000, { ptHistory: steadyHalfYearPtHistory(rule, R(25000), 6) });
    expect(october.pt).toMatchObject({ amount: R(208), halfYearAmount: R(1250) });
    let grossBefore = 0;
    let paidBefore = 0;
    for (let left = 6; left >= 1; left -= 1) {
      paidBefore += halfYearlyPt(rule, R(25000), R(25000), { grossBefore, paidBefore, monthsLeft: left }).amount;
      grossBefore += R(25000);
    }
    expect(paidBefore).toBe(R(1250));
    // ₹1,900 a month = ₹11,400 a half-year: nil.
    expect(ptOf('Kerala', 1900, { ptHistory: steadyHalfYearPtHistory(rule, R(1900), 6) })).toBe(0);
  });
});

describe('the ₹2,500 a year limit (Art. 276)', () => {
  test('this month\'s PT stops at what is left of ₹2,500, whatever its source', () => {
    expect(ptOf('Karnataka', 30000, { ptPaidThisYear: R(2300) })).toBe(200);
    const capped = slipFor('Karnataka', 30000, { ptPaidThisYear: R(2400) });
    expect(capped.pt.amount).toBe(R(100));
    expect(capped.warnings.find((w) => w.code === 'pt_annual_cap').message).toMatch(/₹2,500 a year.*₹2,400.*₹100/);
    expect(ptOf('Karnataka', 30000, { ptPaidThisYear: R(2500) })).toBe(0);
    // A company's own amount can't pass it in one month either.
    expect(ptOf('Jharkhand', 30000, { pt: { manualAmount: R(3000) } })).toBe(2500);
  });

  test('no built-in table comes to more than ₹2,500 over a full year', () => {
    for (const versions of Object.values(statutory.PT_TABLES)) {
      for (const v of versions) {
        const lists = [v.slabs, ...Object.values(v.slabsByGender || {})];
        for (const s of lists.flat()) {
          const year = v.basis === 'half_yearly'
            ? s.amount * 2
            : s.amount * 10 + (s.februaryAmount ?? s.amount) + (s.marchAmount ?? s.amount);
          expect({ id: v.id, upTo: s.upTo, year: year <= statutory.PT_ANNUAL_CAP.amount }).toEqual({ id: v.id, upTo: s.upTo, year: true });
        }
        expect(['confirmed', 'corroborated', 'confirm']).toContain(v.status);
      }
    }
  });
});

// ── The company's own amounts beside the tables (payroll.service) ─────────
const ctxFor = (config = {}) => ({
  companyId: 'c1',
  workingDaysSetting: 26,
  payrollConfig: {},
  ...payroll.resolvePayrollPolicy({
    pf_policy: 'not_applicable', esi_applicable: false, tds_policy: 'none', pt_state_set: true, ...config,
  }),
  rules: normalizePayrollRules({}),
  workWeek: normalizeWorkWeek(null),
  leaveFirst: false,
  components: [],
});
const serviceSlip = (ctx, salary, month, year = 2026) => payroll.computePayslip(ctx, {
  employee: { id: 'e1', gender: 'male', salary_details: salary }, summary: { workingDays: 22 }, records: [], month, year,
});
const cfg = (out) => out.breakdown_json.config;
// Slabs a West Bengal company typed before SpaxSync had a table (₹150 on ₹30,000).
const typedWb = [{ from: 10001, amount: 110 }, { from: 15001, amount: 130 }, { from: 25001, amount: 150 }, { from: 40001, amount: 200 }];

describe('a company\'s own PT amounts and the built-in tables', () => {
  test('West Bengal company with slabs typed earlier: SpaxSync\'s table takes over (₹100, not ₹150, in October)', () => {
    const out = serviceSlip(ctxFor({ pt_state: 'West Bengal', pt_manual_slabs: typedWb }), { basic: 30000 }, 10);
    expect(out.professional_tax).toBe(100);
    expect(cfg(out)).toMatchObject({ pt_company_slabs: false, pt_kind: 'slab', company_values: null });
    expect(cfg(out).rules.pt.id).toBe('PT-WB-2026-10');
  });

  test('…unless the company deliberately chooses its own: then its slabs, recorded and warned', () => {
    const out = serviceSlip(ctxFor({ pt_state: 'West Bengal', pt_manual_slabs: typedWb, pt_override: true }), { basic: 30000 }, 10);
    expect(out.professional_tax).toBe(150);
    expect(cfg(out).pt_company_slabs).toBe(true);
    expect(cfg(out).company_values).toEqual([expect.objectContaining({ key: 'pt', law: 'SpaxSync\'s table', company: 'your own amounts' })]);
    expect(cfg(out).warnings.map((w) => w.code)).toContain('company_values');
    // Chosen with nothing entered: the table still applies.
    expect(serviceSlip(ctxFor({ pt_state: 'West Bengal', pt_override: true }), { basic: 30000 }, 10).professional_tax).toBe(100);
  });

  test('Odisha company with a typed amount: used up to March 2026, ₹0 and not blocked from April', () => {
    const ctx = ctxFor({ pt_state: 'Odisha', pt_manual_amount: 200 });
    expect(serviceSlip(ctx, { basic: 30000 }, 3).professional_tax).toBe(200);
    const april = serviceSlip(ctx, { basic: 30000 }, 4);
    expect(april.professional_tax).toBe(0);
    expect(cfg(april).blockers).toEqual([]);
    expect(cfg(april).rules.pt.id).toBe('PT-OD-2026-04');
    // Without any amount, March is blocked as before; April isn't.
    expect(cfg(serviceSlip(ctxFor({ pt_state: 'Odisha' }), { basic: 30000 }, 3)).blockers.map((b) => b.code)).toEqual(['pt_amount_missing']);
    expect(cfg(serviceSlip(ctxFor({ pt_state: 'Odisha' }), { basic: 30000 }, 4)).blockers).toEqual([]);
    // Chosen over the repeal: the amount, flagged against "no PT".
    const own = serviceSlip(ctxFor({ pt_state: 'Odisha', pt_manual_amount: 200, pt_override: true }), { basic: 30000 }, 4);
    expect(own.professional_tax).toBe(200);
    expect(cfg(own).company_values).toEqual([expect.objectContaining({ key: 'pt', law: 'no PT' })]);
  });

  test('staff in West Bengal of a Karnataka company: the table, or the entered slabs when marked to override', () => {
    const entered = { state: 'West Bengal', slabs: typedWb };
    expect(serviceSlip(ctxFor({ pt_state: 'Karnataka', pt_other_states: [entered] }), { basic: 30000, pt_state: 'West Bengal' }, 10).professional_tax).toBe(100);
    // Before October (old table built in) the typed slabs aren't needed either.
    expect(serviceSlip(ctxFor({ pt_state: 'Karnataka', pt_other_states: [entered] }), { basic: 30000, pt_state: 'West Bengal' }, 9).professional_tax).toBe(150);
    const own = serviceSlip(ctxFor({ pt_state: 'Karnataka', pt_other_states: [{ ...entered, override: true }] }), { basic: 30000, pt_state: 'West Bengal' }, 10);
    expect(own.professional_tax).toBe(150);
    expect(cfg(own).company_values).toEqual([expect.objectContaining({ key: 'pt', label: 'Professional Tax (West Bengal)' })]);
    // The company's own-state choice doesn't reach other states.
    expect(serviceSlip(ctxFor({ pt_state: 'Karnataka', pt_override: true, pt_manual_amount: 0, pt_other_states: [entered] }), { basic: 30000, pt_state: 'West Bengal' }, 10).professional_tax).toBe(100);
  });

  test('no override where the state has no PT at all (Delhi)', () => {
    expect(serviceSlip(ctxFor({ pt_state: 'Delhi', pt_override: true, pt_manual_amount: 200 }), { basic: 30000 }, 10).professional_tax).toBe(0);
  });

  test('the choice as the payroll context carries it (the simulator sets it from the screen)', () => {
    const ctx = ctxFor({ pt_state: 'West Bengal', pt_manual_slabs: typedWb });
    expect(serviceSlip({ ...ctx, ptOverride: true }, { basic: 30000 }, 10).professional_tax).toBe(150);
  });
});

describe('the ₹2,500 limit across a real run (published payslips of the year, this company only)', () => {
  const published = (month, year, pt, extra = {}) => ({
    id: `p${year}-${month}`, employee_id: 'e1', company_id: 'c1', month, year, payslip_status: 'PUBLISHED',
    gross_salary: 40000, professional_tax: pt, breakdown_json: { config: { pt_state: extra.state || 'Maharashtra' } }, ...extra.row,
  });

  beforeEach(async () => {
    global.__db = {
      employees: [{ id: 'e1', company_id: 'c1', gender: 'male', salary_details: { basic: 40000, pt_state: 'Maharashtra' } }],
      payroll: [],
      system_settings: [{ key: settingsKey('c1', 'payroll_config'), value: { pt_state: 'Karnataka', pt_state_set: true, esi_applicable: false } }],
    };
    await settingsService.ensureCache(true);
  });
  afterAll(() => { delete global.__db; });

  test('Chennai April–September (₹1,250), Maharashtra since (₹1,100 to February): March ₹200 → ₹150', async () => {
    global.__db.payroll = [
      ...[[4, 209], [5, 208], [6, 208], [7, 209], [8, 208], [9, 208]].map(([m, pt]) => published(m, 2026, pt, { state: 'Tamil Nadu' })),
      published(10, 2026, 200), published(11, 2026, 200), published(12, 2026, 200), published(1, 2027, 200), published(2, 2027, 300),
      // Another company's payslip, and a draft, never count.
      published(5, 2026, 2500, { row: { company_id: 'c2', id: 'other' } }),
      published(6, 2026, 2500, { row: { payslip_status: 'DRAFT', id: 'draft' } }),
    ];
    const employee = global.__db.employees[0];
    const out = await payroll.calculateContractPayslip(employee, { workingDays: 22 }, 3, { year: 2027, withHistory: true });
    expect(out.professional_tax).toBe(150);
    expect(cfg(out).warnings.map((w) => w.code)).toContain('pt_annual_cap');
    // With less paid before, the full ₹200.
    global.__db.payroll = global.__db.payroll.filter((r) => !(r.month === 2 && r.year === 2027));
    const again = await payroll.calculateContractPayslip(employee, { workingDays: 22 }, 3, { year: 2027, withHistory: true });
    expect(again.professional_tax).toBe(200);
  });
});
