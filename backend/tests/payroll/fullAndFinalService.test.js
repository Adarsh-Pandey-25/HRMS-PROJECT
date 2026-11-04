/**
 * Full and final settlement from the employee's record: the preview, adding
 * it to the final payslip as one-time pay (replacing an earlier one), and
 * when the final payslip can be made. The database is an in-memory stand-in
 * (eq filters applied); attendance, audit and background work are stand-ins.
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
jest.mock('../../src/services/auditLog.service', () => ({ logAudit: () => Promise.resolve(), auditFromRequest: () => {} }));
jest.mock('../../src/utils/background', () => ({ runInBackground: () => {} }));
jest.mock('../../src/utils/logger', () => new Proxy({}, {
  get: (_t, prop) => (prop === '__esModule' || prop === 'then' ? undefined : () => {}),
}));

const fnf = require('../../src/services/fullAndFinal.service');
const payroll = require('../../src/services/payroll.service');
const settingsService = require('../../src/services/settings.service');
const { settingsKey } = require('../../src/utils/tenant');

const leaver = {
  id: 'e1',
  company_id: 'c1',
  is_active: false,
  employment_status: 'offboarded',
  gender: 'male',
  date_of_joining: '2019-06-01',
  last_working_day: '2026-10-31',
  salary_details: { basic: 22000, hra: 8800, special: 9200 },
};
const hr = { id: 'h1', role: 'hr', company_id: 'c1' };

beforeEach(async () => {
  global.__db = {
    employees: [leaver],
    payroll: [],
    payroll_one_time_items: [],
    salary_revisions: [],
    reimbursements: [],
    payroll_components: [],
    leave_balances: [{ employee_id: 'e1', year: 2026, leave_type: 'EL', total_allocated: 15, used: 4, encashed: 0 }],
    system_settings: [{ key: settingsKey('c1', 'payroll_config'), value: { pt_state: 'Karnataka', pt_state_set: true } }],
  };
  await settingsService.ensureCache(true);
});
afterAll(() => { delete global.__db; });

test('the settlement: gratuity 88,846 (7 years), 10.5 days encashed 8,885; no bonus above ₹21,000', async () => {
  const p = await fnf.previewFullAndFinal({ companyId: 'c1', employeeId: 'e1', inputs: { leaveDays: 10.5 } });
  expect(p).toMatchObject({ lastWorkingDay: '2026-10-31', month: 10, year: 2026, monthly: { basicDa: 22000, wages: 22000, gross: 40000 } });
  expect(p.items.map((i) => [i.code, i.kind, i.amount])).toEqual([
    ['GRATUITY', 'gratuity', 88846],
    ['LEAVE_ENCASHMENT', 'leave_encashment', 8885],
  ]);
  expect(p.notes.some((n) => /No statutory bonus/.test(n))).toBe(true);
  expect(p.leaveBalances).toEqual([{ type: 'EL', available: 11 }]);
});

test('notice not served is recovered; inputs that make no sense are refused', async () => {
  const p = await fnf.previewFullAndFinal({
    companyId: 'c1', employeeId: 'e1', inputs: { notice: { requiredDays: 60, servedDays: 45, action: 'recover' } },
  });
  // 15 days short × 40,000 ÷ 30 = 20,000
  expect(p.items.find((i) => i.code === 'NOTICE_RECOVERY')).toMatchObject({ kind: 'notice_recovery', earning: false, amount: 20000 });
  await expect(fnf.previewFullAndFinal({ companyId: 'c1', employeeId: 'e1', inputs: { leaveDays: 2.3 } })).rejects.toThrow(/half days/);
  await expect(fnf.previewFullAndFinal({ companyId: 'c2', employeeId: 'e1', inputs: {} })).rejects.toThrow(/not found/);
  global.__db.employees = [{ ...leaver, last_working_day: null, employment_status: 'active', is_active: true }];
  await expect(fnf.previewFullAndFinal({ companyId: 'c1', employeeId: 'e1', inputs: {} })).rejects.toThrow(/last working day first/);
});

test('adding it to the final payslip replaces a settlement added before, and leaves other one-time pay alone', async () => {
  global.__db.payroll_one_time_items.push(
    { id: 'old-fnf', employee_id: 'e1', month: 10, year: 2026, kind: 'gratuity', name: 'Gratuity', amount: 1, source: 'fnf', status: 'active' },
    { id: 'manual', employee_id: 'e1', month: 10, year: 2026, kind: 'incentive', name: 'Incentive', amount: 500, source: 'manual', status: 'active' },
  );
  const r = await fnf.applyFullAndFinal({ companyId: 'c1', employeeId: 'e1', actor: hr, inputs: { leaveDays: 10.5 } });
  expect(r.added.map((i) => [i.kind, i.amount, i.source])).toEqual([['gratuity', 88846, 'fnf'], ['leave_encashment', 8885, 'fnf']]);
  const byId = Object.fromEntries(global.__db.payroll_one_time_items.map((i) => [i.id, i.status]));
  expect(byId['old-fnf']).toBe('cancelled');
  expect(byId.manual).toBe('active');
  await expect(fnf.applyFullAndFinal({ companyId: 'c1', employeeId: 'e1', actor: { id: 'e1', role: 'hr', company_id: 'c1' }, inputs: {} }))
    .rejects.toThrow(/your own pay/);
});

test('the final payslip can be made the day after the last working day, not before', () => {
  jest.useFakeTimers().setSystemTime(new Date('2026-11-12T10:00:00+05:30'));
  try {
    expect(payroll.leaverFinalMonthReady('2026-11-11', 11, 2026)).toBe(true);
    expect(payroll.leaverFinalMonthReady('2026-11-12', 11, 2026)).toBe(false); // still their last day
    expect(payroll.leaverFinalMonthReady('2026-10-31', 11, 2026)).toBe(false); // another month
    expect(payroll.leaverFinalMonthReady(null, 11, 2026)).toBe(false);
  } finally {
    jest.useRealTimers();
  }
});

test('the last month already published: the settlement goes on a settlement payslip the month after (second review, 3 Nov)', async () => {
  global.__db.payroll = [{ id: 'p-oct', employee_id: 'e1', month: 10, year: 2026, payslip_status: 'PUBLISHED', breakdown_json: { config: {} } }];
  const p = await fnf.previewFullAndFinal({ companyId: 'c1', employeeId: 'e1', inputs: { leaveDays: 10.5 } });
  expect(p).toMatchObject({ month: 11, year: 2026, settlementPayslip: true });
  const r = await fnf.applyFullAndFinal({ companyId: 'c1', employeeId: 'e1', actor: hr, inputs: { leaveDays: 10.5 } });
  expect(r.added.map((i) => [i.kind, i.month])).toEqual([['gratuity', 11], ['leave_encashment', 11]]);
  expect(payroll.isSettlementMonth(leaver, 11, 2026)).toBe(true);
  expect(payroll.isSettlementMonth(leaver, 12, 2026)).toBe(false);
});

test('bonus: an older payslip without stored wages counts its Basic + DA (second review, 3 Nov)', async () => {
  // Basic ₹15,000 (wages under ₹21,000): September (an older payslip: no stored wages, Basic 15,000) + October
  // (final month, all worked) → 2 × min(15,000, 7,000) × 8.33% = 1,166.20 → 1,166 (583 if September counted nothing).
  global.__db.employees = [{ ...leaver, salary_details: { basic: 15000 } }];
  global.__db.payroll = [{
    id: 'p-sep', employee_id: 'e1', month: 9, year: 2026, payslip_status: 'PUBLISHED', basic_salary: 15000,
    breakdown_json: { earnings: [{ name: 'Basic', amount: 15000 }], config: {} },
  }];
  const p = await fnf.previewFullAndFinal({ companyId: 'c1', employeeId: 'e1', inputs: {} });
  expect(p.items.find((i) => i.code === 'BONUS')).toMatchObject({ amount: 1166 });
});
