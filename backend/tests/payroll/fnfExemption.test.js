/**
 * Full and final with the tax-free part of gratuity and leave encashment
 * (audit #14), through the services: the preview shows exempt and taxable
 * parts, adding it stores them on the one-time items (or, before the SQL is
 * run, as two items each), and the final payslip's TDS counts only the
 * taxable part. The database is an in-memory stand-in (eq filters applied);
 * attendance, audit and background work are stand-ins. Nothing is sent.
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
        if (global.__noExemptColumn && table === 'payroll_one_time_items' && list.some((p) => 'exempt_amount' in p)) {
          return { data: null, error: { message: "Could not find the 'exempt_amount' column of 'payroll_one_time_items' in the schema cache" } };
        }
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
  getMonthlySummary: async () => ({ summary: { workingDays: 22, absent: 0, halfDay: 0, late: 0 }, records: [] }),
}));
const quiet = () => new Proxy({}, { get: (_t, prop) => (prop === '__esModule' || prop === 'then' ? undefined : () => Promise.resolve()) });
jest.mock('../../src/services/email.service', () => quiet());
jest.mock('../../src/services/notification.service', () => quiet());
jest.mock('../../src/services/auditLog.service', () => ({ logAudit: (...a) => { (global.__audit || []).push(a[0]); return Promise.resolve(); } }));
jest.mock('../../src/utils/background', () => ({ runInBackground: () => {} }));
jest.mock('../../src/utils/logger', () => new Proxy({}, {
  get: (_t, prop) => (prop === '__esModule' || prop === 'then' ? undefined : () => {}),
}));

const fnf = require('../../src/services/fullAndFinal.service');
const oneTime = require('../../src/services/oneTimePay.service');
const payroll = require('../../src/services/payroll.service');
const settingsService = require('../../src/services/settings.service');
const { settingsKey } = require('../../src/utils/tenant');

// Ten years' service on ₹49,920 Basic + ₹49,920 HRA (≈ ₹12 lakh a year): gratuity 49,920 × 15/26 × 10 = 2,88,000.
const leaver = {
  id: 'e1',
  company_id: 'c1',
  is_active: false,
  employment_status: 'offboarded',
  gender: 'male',
  date_of_joining: '2016-10-01',
  last_working_day: '2026-09-30',
  salary_details: { basic: 49920, hra: 49920 },
};
const hr = { id: 'h1', role: 'hr', company_id: 'c1' };
const admin = { id: 'a1', role: 'admin', company_id: 'c1' };

beforeEach(async () => {
  global.__noExemptColumn = false;
  global.__audit = [];
  global.__db = {
    employees: [leaver, { id: 'h1', company_id: 'c1', is_active: true, role: 'hr' }, { id: 'a1', company_id: 'c1', is_active: true, role: 'admin' }],
    payroll: [],
    payroll_one_time_items: [],
    salary_revisions: [],
    reimbursements: [],
    payroll_components: [],
    leave_balances: [],
    system_settings: [{ key: settingsKey('c1', 'payroll_config'), value: { pt_state: 'Karnataka', pt_state_set: true } }],
  };
  await settingsService.ensureCache(true);
});
afterAll(() => { delete global.__db; delete global.__noExemptColumn; delete global.__audit; });

test('the preview shows each part: gratuity all tax-free, encashment tax-free up to 30 days × the average', async () => {
  const p = await fnf.previewFullAndFinal({ companyId: 'c1', employeeId: 'e1', inputs: { leaveDays: 30 } });
  expect(p.items.find((i) => i.code === 'GRATUITY')).toMatchObject({
    amount: 288000, exempt: 288000, taxable: 0, exemption: { basis: 'act', statutory: 288000, limit: 2000000 },
  });
  // 30 days × 49,920 ÷ 26 = 57,600 paid; tax-free up to 30 × 49,920 ÷ 30 = 49,920 (no payslips: the full monthly Basic).
  expect(p.items.find((i) => i.code === 'LEAVE_ENCASHMENT')).toMatchObject({ amount: 57600, exempt: 49920, taxable: 7680 });
  expect(p.tax).toMatchObject({
    averageBasicDa: 49920, monthsAveraged: 10, monthsEstimated: 10, limits: { gratuity: 2000000, leaveEncashment: 2500000 },
  });
  expect(p.notes.some((n) => /previous employer/.test(n))).toBe(true);
});

test('the average is from published payslips of the 10 months before leaving; exemption already used reduces the limit', async () => {
  // Five months with LOP: 40,000 earned Basic each → average (5 × 40,000 + 5 × 49,920) ÷ 10 = 44,960.
  global.__db.payroll = [5, 6, 7, 8, 9].map((month) => ({
    id: `p${month}`, employee_id: 'e1', month, year: 2026, payslip_status: 'PUBLISHED', basic_salary: 40000,
    breakdown_json: { earnings: [{ name: 'Basic', amount: 40000 }], config: {} },
  }));
  const p = await fnf.previewFullAndFinal({
    companyId: 'c1', employeeId: 'e1', inputs: { leaveDays: 30, exemptionUsed: { gratuity: 1900000, leaveEncashment: 0 } },
  });
  expect(p.tax).toMatchObject({ averageBasicDa: 44960, monthsEstimated: 5 });
  expect(p.items.find((i) => i.code === 'GRATUITY')).toMatchObject({ exempt: 100000, taxable: 188000 });
  expect(p.items.find((i) => i.code === 'LEAVE_ENCASHMENT')).toMatchObject({ exempt: 44960, taxable: 12640 });
  await expect(fnf.previewFullAndFinal({ companyId: 'c1', employeeId: 'e1', inputs: { exemptionUsed: { gratuity: -1 } } }))
    .rejects.toThrow(/already used/);
});

test('adding it stores the exempt part on the item; the final payslip taxes only the rest', async () => {
  const r = await fnf.applyFullAndFinal({ companyId: 'c1', employeeId: 'e1', actor: hr, inputs: { leaveDays: 30 } });
  expect(r.added.map((i) => [i.kind, i.amount, i.exemptAmount, i.taxableAmount])).toEqual([
    ['gratuity', 288000, 288000, 0],
    ['leave_encashment', 57600, 49920, 7680],
  ]);
  expect(global.__db.payroll_one_time_items.map((i) => [i.kind, i.amount, i.exempt_amount, i.taxable])).toEqual([
    ['gratuity', 288000, 288000, true],
    ['leave_encashment', 57600, 49920, true],
  ]);
  // What payroll reads for the payslip (paise): the tax-free part with each item.
  const due = await oneTime.itemsDue('e1', 9, 2026);
  expect(due.map((i) => [i.kind, i.amount, i.exempt])).toEqual([['gratuity', 28800000, 28800000], ['leave_encashment', 5760000, 4992000]]);
});

test('before the SQL is run: each goes on as a tax-free item and a taxable item, so the tax is still right', async () => {
  global.__noExemptColumn = true;
  const r = await fnf.applyFullAndFinal({ companyId: 'c1', employeeId: 'e1', actor: hr, inputs: { leaveDays: 30 } });
  expect(r.added[1]).toMatchObject({ amount: 57600, exemptAmount: 49920, taxableAmount: 7680 });
  expect(global.__db.payroll_one_time_items.map((i) => [i.name, i.amount, i.taxable])).toEqual([
    ['Gratuity (exempt)', 288000, false],
    ['Leave encashment (exempt)', 49920, false],
    ['Leave encashment (taxable)', 7680, true],
  ]);
});

test('a one-time item: the tax-free part can\'t be more than the amount, and only a taxable earning has one', async () => {
  const base = { companyId: 'c1', employeeId: 'e1', actor: hr, month: 9, year: 2026 };
  await expect(oneTime.createItem({ ...base, kind: 'gratuity', amount: 1000, exemptAmount: 1500 })).rejects.toThrow(/tax-free part/);
  const notTaxable = await oneTime.createItem({ ...base, kind: 'gratuity', amount: 1000, taxable: false, exemptAmount: 500 });
  expect(notTaxable.exemptAmount).toBeUndefined();
  expect(global.__db.payroll_one_time_items[0].exempt_amount).toBeUndefined();
});

test('HR can\'t settle their own pay; an Admin can, and it is audit-logged', async () => {
  global.__db.employees.push({ ...leaver, id: 'h2', role: 'hr' });
  await expect(fnf.applyFullAndFinal({ companyId: 'c1', employeeId: 'h2', actor: { id: 'H2', role: 'hr', company_id: 'c1' }, inputs: {} }))
    .rejects.toThrow(/Your own payslip has to be handled by an Admin/);
  global.__db.employees.push({ ...leaver, id: 'a2', role: 'admin' });
  await fnf.applyFullAndFinal({ companyId: 'c1', employeeId: 'a2', actor: { id: 'a2', role: 'admin', company_id: 'c1' }, inputs: {} });
  await new Promise((r) => setImmediate(r));
  expect(global.__audit.some((a) => a.actionType === 'payroll.own_pay.fnf.apply')).toBe(true);
});

test('the final payslip worked out with the stored items shows the tax-free part', async () => {
  await fnf.applyFullAndFinal({ companyId: 'c1', employeeId: 'e1', actor: hr, inputs: {} });
  const employee = global.__db.employees[0];
  const calc = await payroll.calculateContractPayslip(employee, { workingDays: 22 }, 9, { year: 2026, withHistory: true });
  const cfg = calc.breakdown_json.config;
  expect(cfg.one_time[0]).toMatchObject({ name: 'Gratuity', amount: 288000, exempt: 288000, taxable_amount: 0 });
  expect(calc.breakdown_json.earnings).toContainEqual({ name: 'Gratuity (exempt)', amount: 288000, rate: 0 });
  expect(calc.gross_salary).toBeGreaterThan(288000);
});
