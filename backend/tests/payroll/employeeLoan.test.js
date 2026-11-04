/**
 * Loans and salary advances recovered through payroll. The database is an
 * in-memory stand-in (global.__db) applying eq filters and the one-recovery-
 * per-payslip rule. Nothing is sent; audit log and background work are stand-ins.
 */
// Never read backend/.env (the live database's keys) in a test.
jest.mock('dotenv', () => ({ config: () => ({ parsed: {} }) }));
jest.mock('../../src/config/supabase', () => {
  const make = (table) => {
    const state = { filters: [], op: 'select', payload: null };
    const rows = () => global.__db[table] || [];
    const match = (r) => state.filters.every(([f, v]) => String(r[f]) === String(v));
    const run = () => {
      if (global.__missing) return { data: null, error: { message: `relation "public.${table}" does not exist` } };
      if (state.op === 'insert') {
        if (table === 'employee_loan_recoveries'
          && rows().some((r) => r.loan_id === state.payload.loan_id && r.payroll_id === state.payload.payroll_id)) {
          return { data: null, error: { message: 'duplicate key value violates unique constraint' } };
        }
        const row = {
          id: `${table}-${rows().length + 1}`, recovered: 0, status: 'active', created_at: new Date().toISOString(), ...state.payload,
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

const svc = require('../../src/services/employeeLoan.service');

const hr = { id: 'h1', role: 'hr' };
const R = (rupees) => Math.round(rupees * 100);

beforeEach(() => {
  global.__missing = false;
  global.__db = {
    employees: [{ id: 'e1', company_id: 'c1' }, { id: 'h1', company_id: 'c1' }],
    employee_loans: [],
    employee_loan_recoveries: [],
  };
});

test('record a loan; refuse what makes no sense', async () => {
  const loan = await svc.createLoan({
    companyId: 'c1', employeeId: 'e1', actor: hr, principal: 25000, instalment: 5000, startMonth: 11, startYear: 2026,
  });
  expect(loan).toMatchObject({
    kind: 'loan', principal: 25000, instalment: 5000, remaining: 25000, status: 'active',
  });
  const base = {
    companyId: 'c1', employeeId: 'e1', actor: hr, principal: 25000, instalment: 5000, startMonth: 11, startYear: 2026,
  };
  await expect(svc.createLoan({ ...base, instalment: 30000 })).rejects.toThrow(/can't be more than the amount/);
  await expect(svc.createLoan({ ...base, principal: -1 })).rejects.toThrow(/between/);
  await expect(svc.createLoan({ ...base, startMonth: 13 })).rejects.toThrow(/month recovery starts/);
  await expect(svc.createLoan({ ...base, employeeId: 'h1' })).rejects.toThrow(/for yourself/);
  await expect(svc.createLoan({ ...base, companyId: 'c2' })).rejects.toThrow(/not found/);
});

test('what a payslip recovers: started loans only, never more than is left', async () => {
  const a = await svc.createLoan({ companyId: 'c1', employeeId: 'e1', actor: hr, principal: 12000, instalment: 5000, startMonth: 10, startYear: 2026 });
  await svc.createLoan({ companyId: 'c1', employeeId: 'e1', actor: hr, kind: 'advance', principal: 3000, instalment: 3000, startMonth: 12, startYear: 2026 });
  expect(await svc.recoveriesDue('e1', 10, 2026)).toEqual([{ loanId: a.id, kind: 'loan', name: 'Loan recovery', amount: R(5000) }]);
  expect((await svc.recoveriesDue('e1', 12, 2026)).map((r) => r.amount)).toEqual([R(5000), R(3000)]);
  // After 10,000 is recovered, only 2,000 is left of the loan.
  global.__db.employee_loans[0].recovered = 10000;
  expect((await svc.recoveriesDue('e1', 12, 2026))[0].amount).toBe(R(2000));
});

test('publishing records each recovery once and closes a loan that is fully recovered', async () => {
  const a = await svc.createLoan({ companyId: 'c1', employeeId: 'e1', actor: hr, principal: 8000, instalment: 5000, startMonth: 10, startYear: 2026 });
  const oct = { id: 'p-oct', month: 10, year: 2026 };
  expect(await svc.recordRecoveries(oct, [{ loan_id: a.id, amount: 5000 }])).toEqual([{ loan_id: a.id, amount: 5000, closed: false }]);
  expect(await svc.recordRecoveries(oct, [{ loan_id: a.id, amount: 5000 }])).toEqual([]); // the same payslip again: nothing
  expect(global.__db.employee_loans[0]).toMatchObject({ recovered: 5000, status: 'active' });
  await svc.recordRecoveries({ id: 'p-nov', month: 11, year: 2026 }, [{ loan_id: a.id, amount: 3000 }]);
  expect(global.__db.employee_loans[0]).toMatchObject({ recovered: 8000, status: 'closed' });
  await expect(svc.cancelLoan({ companyId: 'c1', employeeId: 'e1', loanId: a.id, actor: hr })).rejects.toThrow(/Only an active loan/);
});

test('a loan can be cancelled only before anything is recovered', async () => {
  const a = await svc.createLoan({ companyId: 'c1', employeeId: 'e1', actor: hr, principal: 8000, instalment: 5000, startMonth: 10, startYear: 2026 });
  const b = await svc.createLoan({ companyId: 'c1', employeeId: 'e1', actor: hr, principal: 9000, instalment: 3000, startMonth: 10, startYear: 2026 });
  await svc.recordRecoveries({ id: 'p-oct', month: 10, year: 2026 }, [{ loan_id: b.id, amount: 3000 }]);
  expect((await svc.cancelLoan({ companyId: 'c1', employeeId: 'e1', loanId: a.id, actor: hr })).status).toBe('cancelled');
  await expect(svc.cancelLoan({ companyId: 'c1', employeeId: 'e1', loanId: b.id, actor: hr })).rejects.toThrow(/already been recovered/);
});

test('before the SQL is run: payroll recovers nothing; the screen says what to do', async () => {
  global.__missing = true;
  expect(await svc.recoveriesDue('e1', 10, 2026)).toEqual([]);
  global.__missing = false;
  global.__db.employees.push({ id: 'e2', company_id: 'c1' });
  global.__missing = true;
  await expect(svc.listLoans('c1', 'e2')).rejects.toThrow();
});

test('a recovery whose bookkeeping failed after publishing is never taken again', async () => {
  // ₹10,000 loan, ₹6,000 a month. October's payslip was published with ₹6,000 recovered, but the
  // loan's own total wasn't updated (still 0). November may take only what is left: ₹4,000.
  const a = await svc.createLoan({ companyId: 'c1', employeeId: 'e1', actor: hr, principal: 10000, instalment: 6000, startMonth: 10, startYear: 2026 });
  global.__db.payroll = [{
    id: 'p-oct', employee_id: 'e1', month: 10, year: 2026, payslip_status: 'PUBLISHED',
    breakdown_json: { config: { loans: [{ loan_id: a.id, amount: 6000 }] } },
  }];
  expect((await svc.recoveriesDue('e1', 11, 2026))[0].amount).toBe(R(4000));
  // And it can't be cancelled as if nothing had been recovered.
  await expect(svc.cancelLoan({ companyId: 'c1', employeeId: 'e1', loanId: a.id, actor: hr })).rejects.toThrow(/already been recovered/);
  expect((await svc.listLoans('c1', 'e1'))[0]).toMatchObject({ recovered: 6000, remaining: 4000 });
});

test('a leaver\'s final pay recovers all that is left of a loan, not one instalment (second review, 3 Nov)', async () => {
  const a = await svc.createLoan({ companyId: 'c1', employeeId: 'e1', actor: hr, principal: 40000, instalment: 5000, startMonth: 10, startYear: 2026 });
  expect((await svc.recoveriesDue('e1', 11, 2026))[0].amount).toBe(R(5000));
  expect(await svc.recoveriesDue('e1', 11, 2026, { finalPay: true })).toEqual([{ loanId: a.id, kind: 'loan', name: 'Loan recovery', amount: R(40000) }]);
});
