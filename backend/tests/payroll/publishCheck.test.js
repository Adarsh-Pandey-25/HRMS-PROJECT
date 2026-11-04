/**
 * Publishing re-checks the draft against a fresh calculation (independent
 * review, 3 Nov): a stale or blocked draft is refused. The database and the
 * attendance summary are stand-ins; nothing is published or sent.
 */
// Never read backend/.env (the live database's keys) in a test.
jest.mock('dotenv', () => ({ config: () => ({ parsed: {} }) }));
jest.mock('../../src/config/supabase', () => {
  const builder = (table) => {
    const rows = () => global.__mockTables?.[table] || [];
    const q = {};
    for (const m of ['select', 'eq', 'neq', 'in', 'gte', 'lte', 'gt', 'lt', 'order', 'range', 'limit', 'is', 'not', 'or', 'ilike']) q[m] = () => q;
    q.maybeSingle = () => Promise.resolve({ data: rows()[0] ?? null, error: null });
    q.single = () => Promise.resolve({ data: rows()[0] ?? null, error: null });
    q.then = (resolve, reject) => Promise.resolve({ data: rows(), error: null }).then(resolve, reject);
    return q;
  };
  return { supabaseAdmin: { from: (t) => builder(t) } };
});
jest.mock('../../src/services/attendance.service', () => ({
  getMonthlySummary: async () => ({ summary: { workingDays: 22, absent: 0, halfDay: 0, late: 0 }, records: [] }),
}));
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
const { settingsKey } = require('../../src/utils/tenant');

const employee = {
  id: 'e1', company_id: 'c1', is_active: true, gender: 'male', salary_details: { basic: 22000, hra: 8800, special: 9200 }, bank_details: {},
};

const draftFromToday = async () => {
  const calc = await payroll.calculateContractPayslip(employee, { workingDays: 22 }, 10, { year: 2026, withHistory: true });
  return {
    id: 'p1', employee_id: 'e1', month: 10, year: 2026, payslip_status: 'DRAFT', ...calc,
  };
};

beforeEach(() => {
  global.__mockTables = {
    employees: [employee],
    payroll: [],
    salary_revisions: [],
    reimbursements: [],
    payroll_components: [],
    // The company works in Karnataka (PT ₹200 from ₹25,000).
    system_settings: [{ key: settingsKey('c1', 'payroll_config'), value: { pt_state: 'Karnataka', pt_state_set: true } }],
  };
});
afterAll(() => { delete global.__mockTables; });

test('a draft that is what the calculation gives today can be published', async () => {
  const draft = await draftFromToday();
  const fresh = await payroll.assertDraftIsCurrent(draft);
  expect(fresh).toMatchObject({ net_salary: draft.net_salary, gross_salary: draft.gross_salary, tds: draft.tds });
  expect(fresh.breakdown_json.config.engine).toBe(2);
});

test('a draft whose figures are out of date is refused', async () => {
  const draft = await draftFromToday();
  await expect(payroll.assertDraftIsCurrent({ ...draft, net_salary: draft.net_salary + 1 })).rejects.toThrow(/generate it again/);
  await expect(payroll.assertDraftIsCurrent({ ...draft, tds: 500 })).rejects.toThrow(/generate it again/);
});

test('a draft the calculation would now refuse can\'t be published either', async () => {
  const draft = await draftFromToday();
  global.__mockTables.employees = [{ ...employee, salary_details: { basic: '22k' } }];
  await expect(payroll.assertDraftIsCurrent(draft)).rejects.toThrow(/can't be published now/);
});

test('a payslip for someone not employed in the month can\'t be published', async () => {
  const draft = await draftFromToday();
  global.__mockTables.employees = [{ ...employee, is_active: false, last_working_day: '2026-09-30' }];
  await expect(payroll.assertDraftIsCurrent(draft)).rejects.toThrow(/can't be published: Left before this month/);
});
