/**
 * One-time pay and recoveries per employee and month. The database is an
 * in-memory stand-in (global.__db) applying eq filters. Nothing is sent; the
 * audit log and background work are stand-ins.
 */
// Never read backend/.env (the live database's keys) in a test.
jest.mock('dotenv', () => ({ config: () => ({ parsed: {} }) }));
jest.mock('../../src/config/supabase', () => {
  const make = (table) => {
    const state = { filters: [], op: 'select', payload: null };
    const rows = () => global.__db[table] || [];
    const match = (r) => state.filters.every(([f, v]) => String(r[f]) === String(v));
    const run = () => {
      if (global.__missing && table === 'payroll_one_time_items') {
        return { data: null, error: { message: 'relation "public.payroll_one_time_items" does not exist' } };
      }
      if (state.op === 'insert') {
        const row = {
          id: `${table}-${rows().length + 1}`, status: 'active', created_at: new Date().toISOString(), ...state.payload,
        };
        global.__db[table] = [...rows(), row];
        return { data: [row], error: null };
      }
      if (state.op === 'update') {
        const hit = rows().filter(match);
        hit.forEach((r) => Object.assign(r, state.payload));
        return { data: hit, error: null };
      }
      return { data: rows().filter(match), error: null };
    };
    const q = {
      select: () => q,
      order: () => q,
      eq: (f, v) => { state.filters.push([f, v]); return q; },
      insert: (p) => { state.op = 'insert'; state.payload = p; return q; },
      update: (p) => { state.op = 'update'; state.payload = p; return q; },
      maybeSingle: () => {
        const r = run();
        return Promise.resolve({ data: r.data ? (r.data[0] ?? null) : null, error: r.error });
      },
      then: (resolve, reject) => Promise.resolve(run()).then(resolve, reject),
    };
    return q;
  };
  return { supabaseAdmin: { from: (t) => make(t) } };
});
jest.mock('../../src/services/auditLog.service', () => ({ logAudit: () => Promise.resolve() }));
jest.mock('../../src/utils/background', () => ({ runInBackground: () => {} }));

const svc = require('../../src/services/oneTimePay.service');

const hr = { id: 'h1', role: 'hr' };
const base = {
  companyId: 'c1', employeeId: 'e1', actor: hr, month: 11, year: 2026,
};

beforeEach(() => {
  global.__missing = false;
  global.__db = {
    employees: [{ id: 'e1', company_id: 'c1' }, { id: 'h1', company_id: 'c1' }],
    payroll: [{ id: 'p-oct', employee_id: 'e1', month: 10, year: 2026, payslip_status: 'PUBLISHED' }],
    payroll_one_time_items: [],
  };
});

test('arrears count for PF and ESI by default; a recovery is never pay (not taxable, no PF or ESI)', async () => {
  const arrears = await svc.createItem({ ...base, kind: 'arrears', amount: 3000, name: 'Arrears: raise from 16 Sep' });
  expect(arrears).toMatchObject({
    kind: 'arrears', earning: true, amount: 3000, taxable: true, pfWage: true, esiWage: true, source: 'manual', name: 'Arrears: raise from 16 Sep',
  });
  const recovery = await svc.createItem({
    ...base, kind: 'notice_recovery', amount: 5000, taxable: true, pfWage: true, esiWage: true,
  });
  expect(recovery).toMatchObject({
    earning: false, taxable: false, pfWage: false, esiWage: false, name: 'Notice period not served',
  });
  // HR can mark a bonus as counting for ESI if their reading says so.
  expect((await svc.createItem({ ...base, kind: 'bonus', amount: 1000, esiWage: true })).esiWage).toBe(true);
});

test('what makes no sense is refused', async () => {
  await expect(svc.createItem({ ...base, kind: 'lottery', amount: 10 })).rejects.toThrow(/what kind/);
  await expect(svc.createItem({ ...base, kind: 'bonus', amount: 0 })).rejects.toThrow(/between/);
  await expect(svc.createItem({ ...base, kind: 'bonus', amount: 10.005 })).rejects.toThrow(/between/);
  await expect(svc.createItem({ ...base, kind: 'bonus', amount: 10, month: 13 })).rejects.toThrow(/payslip month/);
  await expect(svc.createItem({ ...base, kind: 'bonus', amount: 10, employeeId: 'h1' })).rejects.toThrow(/for yourself/);
  await expect(svc.createItem({ ...base, kind: 'bonus', amount: 10, companyId: 'c2' })).rejects.toThrow(/not found/);
});

test('a month whose payslip is published takes nothing new, and its items stay', async () => {
  await expect(svc.createItem({ ...base, kind: 'bonus', amount: 1000, month: 10 })).rejects.toThrow(/already published/);
  global.__db.payroll_one_time_items.push({
    id: 'old', employee_id: 'e1', month: 10, year: 2026, kind: 'bonus', name: 'Bonus', amount: 1000, status: 'active',
  });
  await expect(svc.cancelItem({
    companyId: 'c1', employeeId: 'e1', itemId: 'old', actor: hr,
  })).rejects.toThrow(/already published/);
});

test('the items a payslip uses: active ones of that month, in paise', async () => {
  const a = await svc.createItem({ ...base, kind: 'incentive', amount: 2500.5 });
  const b = await svc.createItem({ ...base, kind: 'other_deduction', amount: 400, name: 'Canteen' });
  await svc.createItem({ ...base, kind: 'bonus', amount: 999, month: 12 });
  await svc.cancelItem({
    companyId: 'c1', employeeId: 'e1', itemId: b.id, actor: hr,
  });
  expect(await svc.itemsDue('e1', 11, 2026)).toEqual([{
    id: a.id, kind: 'incentive', name: 'Incentive', earning: true, amount: 250050, taxable: true, pfWage: false, esiWage: true,
  }]);
});

test('before the SQL is run: payroll adds nothing; the screen says what to do', async () => {
  global.__missing = true;
  expect(await svc.itemsDue('e1', 11, 2026)).toEqual([]);
  await expect(svc.listItems('c1', 'e1')).rejects.toThrow(/20261104_payroll_one_time_items.sql/);
});

test('a regular line\'s name can\'t be used, and only a month they are paid in is accepted (second review, 3 Nov)', async () => {
  await expect(svc.createItem({ ...base, kind: 'other_deduction', amount: 100, name: 'TDS' })).rejects.toThrow(/name of its own/);
  await expect(svc.createItem({ ...base, kind: 'bonus', amount: 100, name: 'Basic' })).rejects.toThrow(/name of its own/);
  // Left on 31 October: October and November (a settlement payslip) are fine; December isn't.
  global.__db.employees[0] = { id: 'e1', company_id: 'c1', is_active: false, last_working_day: '2026-10-31' };
  global.__db.payroll = [];
  expect((await svc.createItem({ ...base, kind: 'gratuity', amount: 1000, month: 11 })).month).toBe(11);
  await expect(svc.createItem({ ...base, kind: 'gratuity', amount: 1000, month: 12 })).rejects.toThrow(/left on 2026-10-31/);
});
