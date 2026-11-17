/**
 * HR can't change their own pay: no salary revision for themselves (create,
 * cancel or apply) and no cancelling a loan or advance recorded against them.
 * An Admin may. Ids are matched ignoring case, as the database does. The
 * database is an in-memory stand-in; nothing is sent.
 */
// Never read backend/.env (the live database's keys) in a test.
jest.mock('dotenv', () => ({ config: () => ({ parsed: {} }) }));
jest.mock('../../src/config/supabase', () => {
  // uuid columns compare without case, like Postgres.
  const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
  const make = (table) => {
    const state = { filters: [], op: 'select', payload: null };
    const rows = () => global.__db[table] || [];
    const match = (r) => state.filters.every(([f, v, kind]) => (kind === 'in' ? v.some((x) => same(r[f], x)) : same(r[f], v)));
    const run = () => {
      if (state.op === 'insert') {
        const row = {
          id: `${table}-${rows().length + 1}`, recovered: 0, status: table === 'salary_revisions' ? 'scheduled' : 'active', ...state.payload,
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
      limit: () => q,
      eq: (f, v) => { state.filters.push([f, v]); return q; },
      in: (f, v) => { state.filters.push([f, v, 'in']); return q; },
      lte: () => q,
      insert: (p) => { state.op = 'insert'; state.payload = p; return q; },
      update: (p) => { state.op = 'update'; state.payload = p; return q; },
      maybeSingle: () => {
        const r = run();
        return Promise.resolve({ data: r.data ? (r.data[0] ?? null) : null, error: r.error });
      },
      single: () => q.maybeSingle(),
      then: (resolve, reject) => Promise.resolve(run()).then(resolve, reject),
    };
    return q;
  };
  return { supabaseAdmin: { from: (t) => make(t) } };
});
jest.mock('../../src/utils/logger', () => new Proxy({}, {
  get: (_t, prop) => (prop === '__esModule' || prop === 'then' ? undefined : () => {}),
}));
jest.mock('../../src/services/auditLog.service', () => ({ logAudit: jest.fn(() => Promise.resolve()) }));
jest.mock('../../src/utils/background', () => ({ runInBackground: () => {} }));

const { logAudit } = require('../../src/services/auditLog.service');
const revisions = require('../../src/services/salaryRevision.service');
const loans = require('../../src/services/employeeLoan.service');

const HR_ID = 'aaaaaaaa-1111-4111-8111-111111111111';
const ADMIN_ID = 'bbbbbbbb-2222-4222-8222-222222222222';
const EMP_ID = 'cccccccc-3333-4333-8333-333333333333';
const hr = { id: HR_ID, role: 'hr', company_id: 'c1' };
const admin = { id: ADMIN_ID, role: 'admin', company_id: 'c1' };
const salary = {
  basic: 30000, hra: 12000, da: 0, special: 8000, transport: 0, medical: 0,
};
const raise = { ...salary, basic: 500000 };
const nextMonth = () => {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 10);
};
const refusedAudit = (actionType, attempted) => expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
  actionType, actorId: HR_ID, actorRole: 'hr', afterState: expect.objectContaining({ attempted }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  global.__db = {
    employees: [HR_ID, ADMIN_ID, EMP_ID].map((id) => ({
      id, company_id: 'c1', first_name: 'P', last_name: 'Q', is_active: true, salary_details: { ...salary },
    })),
    salary_revisions: [],
    employee_loans: [],
    employee_loan_recoveries: [],
    payroll: [],
  };
});

describe('salary revisions', () => {
  const create = (actor, employeeId, effectiveDate = '2026-10-01') => revisions.createRevision({
    scopeIds: ['c1'], actor, ipAddress: '10.0.0.1', employeeId, components: raise, effectiveDate,
  });

  test.each([
    ['their own id', HR_ID],
    ['their own id in capitals', HR_ID.toUpperCase()],
  ])('HR can\'t revise their own salary (%s), even back-dated; the attempt is logged', async (_label, id) => {
    await expect(create(hr, id)).rejects.toMatchObject({ statusCode: 403, message: 'An Admin has to revise your salary.' });
    expect(global.__db.salary_revisions).toHaveLength(0);
    expect(global.__db.employees[0].salary_details.basic).toBe(30000);
    refusedAudit('salary_revision.self_refused', 'create');
  });

  test('HR still revises someone else\'s salary', async () => {
    const rev = await create(hr, EMP_ID, nextMonth());
    expect(rev).toMatchObject({ employee_id: EMP_ID, status: 'scheduled' });
  });

  test('an Admin may revise their own salary; the audit says it was their own', async () => {
    const rev = await create(admin, ADMIN_ID.toUpperCase(), nextMonth());
    expect(rev).toMatchObject({ employee_id: ADMIN_ID, status: 'scheduled' });
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      actionType: 'salary_revision.create', actorId: ADMIN_ID, afterState: expect.objectContaining({ self_revision: true }),
    }));
  });

  test('HR can\'t cancel or apply a revision for themselves', async () => {
    global.__db.salary_revisions.push({
      id: 'r1', company_id: 'c1', employee_id: HR_ID, status: 'scheduled', new_salary: raise, effective_date: '2026-10-01',
    });
    await expect(revisions.cancelRevision({ scopeIds: ['c1'], actor: hr, id: 'r1' }))
      .rejects.toMatchObject({ statusCode: 403, message: 'An Admin has to revise your salary.' });
    refusedAudit('salary_revision.self_refused', 'cancel');
    await expect(revisions.applyRevision('r1', { actorId: HR_ID.toUpperCase(), actorRole: 'hr' }))
      .rejects.toMatchObject({ statusCode: 403 });
    expect(global.__db.salary_revisions[0].status).toBe('scheduled');
    expect(global.__db.employees[0].salary_details.basic).toBe(30000);
    // An Admin may cancel it.
    expect((await revisions.cancelRevision({ scopeIds: ['c1'], actor: admin, id: 'r1' })).status).toBe('cancelled');
  });
});

describe('loans and advances', () => {
  const loan = (employeeId) => ({
    id: `l-${employeeId}`, company_id: 'c1', employee_id: employeeId, kind: 'advance', principal: 200000, instalment: 20000, start_month: 12, start_year: 2026, recovered: 0, status: 'active',
  });

  test('HR can\'t cancel an advance recorded against them, even with their id in capitals', async () => {
    global.__db.employee_loans.push(loan(HR_ID));
    for (const id of [HR_ID, HR_ID.toUpperCase()]) {
      // eslint-disable-next-line no-await-in-loop
      await expect(loans.cancelLoan({
        companyId: 'c1', employeeId: id, loanId: `l-${HR_ID}`, actor: hr,
      })).rejects.toMatchObject({ statusCode: 403, message: 'You cannot cancel your own loan or advance — an Admin has to.' });
    }
    expect(global.__db.employee_loans[0].status).toBe('active');
    refusedAudit('payroll.loan.self_refused', 'cancel');
  });

  test('HR still cancels someone else\'s loan; an Admin may cancel their own', async () => {
    global.__db.employee_loans.push(loan(EMP_ID), loan(ADMIN_ID));
    expect((await loans.cancelLoan({
      companyId: 'c1', employeeId: EMP_ID, loanId: `l-${EMP_ID}`, actor: hr,
    })).status).toBe('cancelled');
    expect((await loans.cancelLoan({
      companyId: 'c1', employeeId: ADMIN_ID, loanId: `l-${ADMIN_ID}`, actor: admin,
    })).status).toBe('cancelled');
  });

  test('HR can\'t add a loan for themselves by typing their id in capitals', async () => {
    await expect(loans.createLoan({
      companyId: 'c1', employeeId: HR_ID.toUpperCase(), actor: hr, principal: 1000, instalment: 500, startMonth: 12, startYear: 2026,
    })).rejects.toMatchObject({ statusCode: 403 });
    expect(global.__db.employee_loans).toHaveLength(0);
    refusedAudit('payroll.loan.self_refused', 'create');
  });
});

describe('back-dated salary revisions (only an Admin reaches into an earlier month)', () => {
  const todayIst = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const firstOfMonth = () => `${todayIst().slice(0, 8)}01`;
  const lastMonth = () => {
    const [y, m] = todayIst().split('-').map(Number);
    const py = m === 1 ? y - 1 : y;
    const pm = m === 1 ? 12 : m - 1;
    return `${py}-${String(pm).padStart(2, '0')}-15`;
  };
  const create = (actor, employeeId, effectiveDate) => revisions.createRevision({
    scopeIds: ['c1'], actor, ipAddress: '10.0.0.1', employeeId, components: raise, effectiveDate,
  });

  test('HR back-dating someone else\'s revision to an earlier month is refused and logged', async () => {
    await expect(create(hr, EMP_ID, lastMonth())).rejects.toMatchObject({
      statusCode: 403, message: 'Only an Admin can back-date a salary revision to an earlier month.',
    });
    expect(global.__db.salary_revisions).toHaveLength(0);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ actionType: 'salary_revision.backdate_refused' }));
  });

  test('HR may date it from the first of this month', async () => {
    const rev = await create(hr, EMP_ID, firstOfMonth());
    expect(rev).toMatchObject({ employee_id: EMP_ID });
  });

  test('an Admin may back-date it', async () => {
    const rev = await create(admin, EMP_ID, lastMonth());
    expect(rev).toMatchObject({ employee_id: EMP_ID });
  });
});
