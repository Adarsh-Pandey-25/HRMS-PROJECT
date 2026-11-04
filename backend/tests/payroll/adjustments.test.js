/**
 * Changes after publishing: last month's published payslips worked out again
 * with today's attendance; the difference goes on this month's payslip as
 * arrears (wages part counts for PF) or a recovery. The database is an
 * in-memory stand-in (eq filters applied); attendance is a stand-in.
 * Nothing is sent.
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
      return { data: rows().filter(match), error: null };
    };
    const q = {};
    for (const m of ['select', 'order', 'in', 'gte', 'lte', 'neq', 'limit', 'ilike', 'is', 'not', 'or']) q[m] = () => q;
    q.eq = (f, v) => { state.filters.push([f, v]); return q; };
    q.insert = (p) => { state.op = 'insert'; state.payload = p; return q; };
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
  getMonthlySummary: async () => ({ summary: global.__summaryNow, records: [] }),
}));
const quiet = () => new Proxy({}, { get: (_t, prop) => (prop === '__esModule' || prop === 'then' ? undefined : () => Promise.resolve()) });
jest.mock('../../src/services/email.service', () => quiet());
jest.mock('../../src/services/notification.service', () => quiet());
jest.mock('../../src/services/auditLog.service', () => ({ logAudit: () => Promise.resolve(), auditFromRequest: () => {} }));
jest.mock('../../src/utils/background', () => ({ runInBackground: () => {} }));
jest.mock('../../src/utils/logger', () => new Proxy({}, {
  get: (_t, prop) => (prop === '__esModule' || prop === 'then' ? undefined : () => {}),
}));

const payroll = require('../../src/services/payroll.service');
const adjustments = require('../../src/services/payrollAdjustments.service');
const settingsService = require('../../src/services/settings.service');
const { settingsKey } = require('../../src/utils/tenant');

const employee = {
  id: 'e1', company_id: 'c1', first_name: 'Asha', last_name: 'Rao', is_active: true, gender: 'male',
  salary_details: { basic: 22000, hra: 8800, special: 9200 },
};
const hr = { id: 'h1', role: 'hr', company_id: 'c1' };

beforeEach(async () => {
  global.__db = {
    employees: [employee],
    payroll: [],
    payroll_one_time_items: [],
    salary_revisions: [],
    reimbursements: [],
    payroll_components: [],
    system_settings: [{ key: settingsKey('c1', 'payroll_config'), value: { pt_state: 'Karnataka', pt_state_set: true } }],
  };
  await settingsService.ensureCache(true);
  // October as published: 2 of 22 days absent → 20,000 + 8,000 + 8,364 = 36,364.
  const ctx = await payroll.loadPayrollContext('c1');
  const oct = payroll.computePayslip(ctx, { employee, summary: { workingDays: 22, absent: 2 }, records: [], month: 10, year: 2026 });
  global.__db.payroll = [{
    id: 'p-oct', employee_id: 'e1', company_id: 'c1', month: 10, year: 2026, payslip_status: 'PUBLISHED',
    gross_salary: oct.gross_salary, net_salary: oct.net_salary, breakdown_json: oct.breakdown_json,
  }];
  // Since then the two absences were corrected (approved as work): every day counts.
  global.__summaryNow = { workingDays: 22, absent: 0 };
});
afterAll(() => { delete global.__db; delete global.__summaryNow; });

test('October worked out again: 20 → 22 paid days, 36,364 → 40,000 — 3,636 to add to November', async () => {
  const r = await adjustments.findAdjustments('c1', 11, 2026);
  expect(r.from).toEqual({ month: 10, year: 2026 });
  expect(r.items).toEqual([{
    employeeId: 'e1', name: 'Asha Rao', paidDaysThen: 20, paidDaysNow: 22, paidThen: 36364, paidNow: 40000, difference: 3636, wagesDifference: 2000, added: false,
  }]);
});

test('added as arrears: the 2,000 of Basic counts for PF, the other 1,636 doesn\'t; never added twice', async () => {
  const done = await adjustments.applyAdjustments({ companyId: 'c1', month: 11, year: 2026, employeeIds: ['e1'], actor: hr });
  expect(done.added).toEqual([{ employeeId: 'e1', difference: 3636 }]);
  const items = global.__db.payroll_one_time_items.map((i) => [i.month, i.kind, i.name, i.amount, i.pf_wage, i.esi_wage]);
  expect(items).toEqual([
    [11, 'arrears', 'Arrears for October 2026', 2000, true, true],
    [11, 'arrears', 'Arrears for October 2026 (other pay)', 1636, false, true],
  ]);
  const again = await adjustments.applyAdjustments({ companyId: 'c1', month: 11, year: 2026, employeeIds: ['e1'], actor: hr });
  expect(again.added).toEqual([]);
  expect(again.skipped).toEqual([{ employeeId: 'e1', reason: 'Already added to this month' }]);
});

test('paid too much (an absence found later): a recovery of what was overpaid', async () => {
  global.__summaryNow = { workingDays: 22, absent: 3 };
  // 19 of 22 days now: 19,000 + 7,600 + 7,945.45 → 7,945 = 34,545; overpaid 36,364 − 34,545 = 1,819
  const r = await adjustments.findAdjustments('c1', 11, 2026);
  expect(r.items[0]).toMatchObject({ paidDaysNow: 19, paidNow: 34545, difference: -1819 });
  await adjustments.applyAdjustments({ companyId: 'c1', month: 11, year: 2026, employeeIds: ['e1'], actor: hr });
  expect(global.__db.payroll_one_time_items.map((i) => [i.kind, i.name, i.amount])).toEqual([['other_deduction', 'Overpaid in October 2026', 1819]]);
});

test('nothing changed: nothing to add', async () => {
  global.__summaryNow = { workingDays: 22, absent: 2 };
  expect((await adjustments.findAdjustments('c1', 11, 2026)).items).toEqual([]);
});
