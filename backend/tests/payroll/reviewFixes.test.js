/**
 * Fixes from the independent review of 3 Nov (second round) that need the
 * database: Tamil Nadu's half-year PT counts only its own months; only an
 * admin switches approval before publishing on or off; a new company copies
 * no other company's state, PT, LWF or statutory choices. The database is an
 * in-memory stand-in (eq filters applied). Nothing is sent.
 */
// Never read backend/.env (the live database's keys) in a test.
jest.mock('dotenv', () => ({ config: () => ({ parsed: {} }) }));
jest.mock('../../src/config/supabase', () => {
  const make = (table) => {
    const state = { filters: [], op: 'select', payload: null };
    const rows = () => global.__db[table] || [];
    const match = (r) => state.filters.every(([f, v]) => String(r[f]) === String(v));
    const run = () => {
      if (state.op === 'upsert') {
        const existing = rows().find((r) => r.key === state.payload.key);
        if (existing) Object.assign(existing, state.payload);
        else global.__db[table] = [...rows(), { ...state.payload }];
        return { data: [rows().find((r) => r.key === state.payload.key)], error: null };
      }
      return { data: rows().filter(match), error: null };
    };
    const q = {};
    for (const m of ['select', 'order', 'in', 'gte', 'lte', 'neq', 'limit', 'ilike', 'is', 'not', 'or']) q[m] = () => q;
    q.eq = (f, v) => { state.filters.push([f, v]); return q; };
    q.upsert = (p) => { state.op = 'upsert'; state.payload = p; return q; };
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
const quiet = () => new Proxy({}, { get: (_t, prop) => (prop === '__esModule' || prop === 'then' ? undefined : () => Promise.resolve()) });
jest.mock('../../src/services/email.service', () => quiet());
jest.mock('../../src/services/notification.service', () => quiet());
jest.mock('../../src/services/auditLog.service', () => ({ logAudit: () => Promise.resolve(), auditFromRequest: () => {} }));
jest.mock('../../src/utils/logger', () => new Proxy({}, {
  get: (_t, prop) => (prop === '__esModule' || prop === 'then' ? undefined : () => {}),
}));

const payroll = require('../../src/services/payroll.service');
const settingsService = require('../../src/services/settings.service');
const { settingsKey, DEFAULT_COMPANY_ID } = require('../../src/utils/tenant');

const slipIn = (month, state, pt) => ({
  id: `p${month}`, employee_id: 'e1', company_id: 'c1', month, year: 2026, payslip_status: 'PUBLISHED',
  gross_salary: 40000, professional_tax: pt, breakdown_json: { config: { pt_state: state } },
});

beforeEach(async () => {
  global.__db = {
    employees: [{ id: 'e1', company_id: 'c1', gender: 'male', salary_details: { basic: 40000, pt_state: 'Tamil Nadu' } }],
    payroll: [],
    system_settings: [{ key: settingsKey('c1', 'payroll_config'), value: { pt_state: 'Karnataka', pt_state_set: true } }],
  };
  await settingsService.ensureCache(true);
});
afterAll(() => { delete global.__db; });

test('Tamil Nadu: the half-year counts only months whose PT went to Tamil Nadu', async () => {
  // April–June in Karnataka (₹200 a month there); from July in Chennai at ₹40,000. July: nothing paid
  // to Tamil Nadu yet, 3 months left → 40,000 × 3 = 1,20,000 → ₹1,250 for the half-year → 1,250 ÷ 3 = 416.67 → 417.
  global.__db.payroll = [slipIn(4, 'Karnataka', 200), slipIn(5, 'Karnataka', 200), slipIn(6, 'Karnataka', 200)];
  const employee = global.__db.employees[0];
  const out = await payroll.calculateContractPayslip(employee, { workingDays: 23 }, 7, { year: 2026, withHistory: true });
  expect(out.breakdown_json.config).toMatchObject({ pt_state: 'Tamil Nadu', pt_half_year_amount: 1250 });
  expect(out.professional_tax).toBe(417);
  // A Karnataka draft from earlier in the half-year doesn't hold up Tamil Nadu's PT.
  global.__db.payroll = [{ ...slipIn(6, 'Karnataka', 200), payslip_status: 'DRAFT' }];
  const again = await payroll.calculateContractPayslip(employee, { workingDays: 23 }, 7, { year: 2026, withHistory: true });
  expect(again.breakdown_json.config.blockers.map((b) => b.code)).not.toContain('pt_earlier_draft');
});

test('a new company copies no other company\'s state, PT, LWF or statutory choices', async () => {
  global.__db.system_settings.push({
    key: settingsKey(DEFAULT_COMPANY_ID, 'payroll_config'),
    value: {
      pt_state: 'Maharashtra', pt_state_set: true, pt_manual_amount: 200, pt_other_states: [{ state: 'Gujarat', slabs: [] }],
      lwf_states: [{ state: 'Maharashtra', employee: 25, employer: 75, months: [6, 12] }],
      pf_policy: 'not_applicable', esi_applicable: false, tds_policy: 'projected', run_date: 3, auto_process: false,
    },
  });
  await settingsService.ensureCache(true);
  await settingsService.seedCompanySettings('newco', { name: 'New Co' });
  const copied = global.__db.system_settings.find((s) => s.key === settingsKey('newco', 'payroll_config')).value;
  expect(copied).toEqual({ run_date: 3, auto_process: false });
});

test('only an admin can switch approval before publishing on or off', async () => {
  const { updateKey } = require('../../src/controllers/settings.controller');
  const call = async (role, value) => {
    let failure = null;
    let ok = null;
    await updateKey(
      { params: { key: 'payroll_calc' }, body: { value }, user: { id: 'u1', role, company_id: 'c1' }, ip: '127.0.0.1' },
      { status: () => ({ json: (body) => { ok = body; } }), json: (body) => { ok = body; } },
      (err) => { failure = err; },
    );
    return { failure, ok };
  };
  const hrTurnsOn = await call('hr', { approval: { required: true } });
  expect(hrTurnsOn.failure?.message).toMatch(/Only an admin/);
  // HR can still change other values.
  expect((await call('hr', { pf: { employeeRate: 10 } })).failure).toBeNull();
  const adminTurnsOn = await call('admin', { pf: { employeeRate: 10 }, approval: { required: true } });
  expect(adminTurnsOn.failure).toBeNull();
  // With it on, HR changing a rate (approval left as it is) is fine; switching it off is not.
  expect((await call('hr', { pf: { employeeRate: 12 }, approval: { required: true } })).failure).toBeNull();
  expect((await call('hr', { approval: { required: false } })).failure?.message).toMatch(/Only an admin/);
});

test('one-time pay marked not taxable isn\'t taxed in later months either (second review, 3 Nov)', async () => {
  // October: ₹1,00,000 salary + ₹3,00,000 exempt (not taxable) → only 1,00,000 counts as salary paid.
  global.__db.payroll = [{
    id: 'p10', employee_id: 'e1', company_id: 'c1', month: 10, year: 2026, payslip_status: 'PUBLISHED',
    gross_salary: 400000, tds: 0, professional_tax: 200,
    breakdown_json: { config: { one_time: [{ id: 'g1', name: 'Gratuity', earning: true, amount: 300000, taxable: false }] } },
  }];
  const h = await payroll.loadTaxYearHistory(global.__db.employees[0], 11, 2026);
  expect(h.salaryPaid).toBe(100000_00);
});

test('a new company doesn\'t get the old PF/ESI rates that would switch them off (second review, 3 Nov)', async () => {
  global.__db.system_settings.push(
    { key: settingsKey(DEFAULT_COMPANY_ID, 'payroll_pf_rate'), value: 0 },
    { key: settingsKey(DEFAULT_COMPANY_ID, 'payroll_esi_employee_percent'), value: 0 },
  );
  await settingsService.ensureCache(true);
  await settingsService.seedCompanySettings('newco2', { name: 'New Co 2' });
  const keys = global.__db.system_settings.map((s) => s.key);
  expect(keys).not.toContain(settingsKey('newco2', 'payroll_pf_rate'));
  expect(keys).not.toContain(settingsKey('newco2', 'payroll_esi_employee_percent'));
});
