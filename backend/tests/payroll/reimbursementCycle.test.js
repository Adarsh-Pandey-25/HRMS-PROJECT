/**
 * The reimbursement cycle (report defect D10): a payslip pays every approved,
 * unpaid claim up to its month's end, and publishing marks them paid, so a
 * claim approved after its month is paid next month — never twice, never
 * not at all. The database is an in-memory stand-in (eq filters applied).
 * Nothing is sent.
 */
// Never read backend/.env (the live database's keys) in a test.
jest.mock('dotenv', () => ({ config: () => ({ parsed: {} }) }));
jest.mock('../../src/config/supabase', () => {
  const make = (table) => {
    const state = { filters: [], ins: [], op: 'select', payload: null };
    const rows = () => global.__db[table] || [];
    const match = (r) => state.filters.every(([f, v]) => String(r[f]) === String(v))
      && state.ins.every(([f, list]) => list.map(String).includes(String(r[f])));
    const run = () => {
      if (state.op === 'update') {
        const hit = rows().filter(match);
        hit.forEach((r) => Object.assign(r, state.payload));
        return { data: hit, error: null };
      }
      return { data: rows().filter(match), error: null };
    };
    const q = {};
    for (const m of ['select', 'order', 'gte', 'lte', 'neq', 'limit']) q[m] = () => q;
    q.eq = (f, v) => { state.filters.push([f, v]); return q; };
    q.in = (f, list) => { state.ins.push([f, list]); return q; };
    q.update = (p) => { state.op = 'update'; state.payload = p; return q; };
    q.then = (resolve, reject) => Promise.resolve(run()).then(resolve, reject);
    return q;
  };
  return { supabaseAdmin: { from: (t) => make(t) } };
});
const quiet = () => new Proxy({}, { get: (_t, prop) => (prop === '__esModule' || prop === 'then' ? undefined : () => Promise.resolve()) });
jest.mock('../../src/services/email.service', () => quiet());
jest.mock('../../src/services/notification.service', () => quiet());
jest.mock('../../src/utils/logger', () => new Proxy({}, {
  get: (_t, prop) => (prop === '__esModule' || prop === 'then' ? undefined : () => {}),
}));

const payroll = require('../../src/services/payroll.service');

const claim = (id, date, amount, status = 'approved') => ({
  id, employee_id: 'e1', reimbursement_type: 'travel', description: `Travel ${id}`, amount, expense_date: date, status,
});

beforeEach(() => {
  global.__db = {
    reimbursements: [
      claim('r-sep', '2026-09-20', 500), // September's, approved only after September's payslip
      claim('r-oct', '2026-10-05', 1200),
      claim('r-nov', '2026-11-02', 300), // next month's
      claim('r-pending', '2026-10-06', 999, 'pending'),
      { ...claim('r-other', '2026-10-07', 700), employee_id: 'e2' },
    ],
    payroll: [],
  };
});
afterAll(() => { delete global.__db; });

test('October pays every approved, unpaid claim up to 31 October — September\'s late one too', async () => {
  const list = await payroll.fetchMonthReimbursements('e1', 10, 2026);
  expect(list.map((c) => [c.id, c.amount])).toEqual([['r-sep', 500], ['r-oct', 1200]]);
});

test('publishing marks them paid; a claim on a published payslip is never paid again', async () => {
  const payslip = {
    id: 'p-oct', employee_id: 'e1', month: 10, year: 2026, employee: { company_id: 'c1' },
    breakdown_json: { config: {}, reimbursements: [{ id: 'r-sep', name: 'Travel r-sep', amount: 500 }, { id: 'r-oct', name: 'Travel r-oct', amount: 1200 }] },
  };
  const config = await payroll.applyPublishEffects(payslip, { id: 'h1', company_id: 'c1' });
  expect(config.reimbursements_paid_at).toBeTruthy();
  expect(global.__db.reimbursements.filter((r) => r.status === 'paid').map((r) => r.id)).toEqual(['r-sep', 'r-oct']);
  // Even if a claim's status hadn't changed, the published payslip already paid it.
  global.__db.reimbursements.find((r) => r.id === 'r-oct').status = 'approved';
  global.__db.payroll = [{ ...payslip, payslip_status: 'PUBLISHED' }];
  expect((await payroll.fetchMonthReimbursements('e1', 11, 2026)).map((c) => c.id)).toEqual(['r-nov']);
});
