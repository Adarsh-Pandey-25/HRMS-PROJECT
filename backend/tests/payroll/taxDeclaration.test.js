/**
 * Employee tax declarations (Form 124): the employee declares, HR checks,
 * and the amounts allowed reach the payroll tax profile. The database is an
 * in-memory stand-in (global.__db) that applies eq/neq filters. Nothing is
 * sent; the audit log and background work are stand-ins.
 */
// Never read backend/.env (the live database's keys) in a test.
jest.mock('dotenv', () => ({ config: () => ({ parsed: {} }) }));
jest.mock('../../src/config/supabase', () => {
  const make = (table) => {
    const state = { filters: [], op: 'select', payload: null };
    const rows = () => global.__db[table] || [];
    const match = (r) => state.filters.every(([f, v, neg]) => (neg ? String(r[f]) !== String(v) : String(r[f]) === String(v)));
    const run = () => {
      if (global.__fail?.[table]) return { data: null, error: { message: global.__fail[table] } };
      if (state.op === 'insert') {
        const row = { id: `${table}-${rows().length + 1}`, ...state.payload };
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
      eq: (f, v) => { state.filters.push([f, v, false]); return q; },
      neq: (f, v) => { state.filters.push([f, v, true]); return q; },
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
jest.mock('../../src/utils/background', () => ({ runInBackground: (label) => global.__background.push(label) }));

const moment = require('moment-timezone');
const svc = require('../../src/services/taxDeclaration.service');
const { taxYearOf } = require('../../src/payroll/taxRules');

const now = moment.tz('Asia/Kolkata');
const TY = taxYearOf(now.month() + 1, now.year());
const employee = { id: 'e1', company_id: 'c1', role: 'employee' };
const hr = { id: 'h1', company_id: 'c1', role: 'hr' };

beforeEach(() => {
  global.__background = [];
  global.__fail = {};
  global.__db = {
    tax_declarations: [],
    employees: [{
      id: 'e1',
      company_id: 'c1',
      salary_details: { basic: 50000, tax_profile: { years: { [TY]: { regime: 'new', earlier_income: 300000, earlier_tds: 5000 } } } },
    }],
  };
});

test('an employee with nothing saved gets a blank declaration for this tax year', async () => {
  expect(await svc.getMyDeclaration(employee)).toMatchObject({ id: null, taxYear: TY, regime: 'new', status: 'none' });
});

test('save, then send to HR; while HR has it, it can\'t change', async () => {
  const draft = await svc.saveMyDeclaration(employee, {
    taxYear: TY, regime: 'old', declared: { rent_paid: 240000, section_80c: 150000, metro_city: true, bogus: 5 },
  });
  expect(draft).toMatchObject({ status: 'draft', regime: 'old', declared: { rent_paid: 240000, section_80c: 150000, metro_city: true } });
  expect(draft.declared.bogus).toBeUndefined();
  const sent = await svc.saveMyDeclaration(employee, { taxYear: TY, regime: 'old', declared: { section_80c: 150000 }, submit: true });
  expect(sent.status).toBe('submitted');
  expect(global.__db.tax_declarations).toHaveLength(1);
  await expect(svc.saveMyDeclaration(employee, { taxYear: TY, regime: 'new' })).rejects.toThrow(/with HR for checking/);
});

test('bad input is refused', async () => {
  await expect(svc.saveMyDeclaration(employee, { taxYear: TY, regime: 'middle' })).rejects.toThrow(/new or old/);
  await expect(svc.saveMyDeclaration(employee, { taxYear: TY, declared: { lta: -1 } })).rejects.toThrow(/between ₹0/);
  await expect(svc.saveMyDeclaration(employee, { taxYear: TY, declared: { lta: 10.555 } })).rejects.toThrow(/between ₹0/);
  await expect(svc.saveMyDeclaration(employee, { taxYear: '2019-20' })).rejects.toThrow(/open for/);
  await expect(svc.saveMyDeclaration(employee, { taxYear: '2026-28' })).rejects.toThrow(/2026-27/);
});

test('HR accepts with the allowed amounts: they reach the tax profile; other inputs stay', async () => {
  const sent = await svc.saveMyDeclaration(employee, { taxYear: TY, regime: 'old', declared: { section_80c: 200000 }, submit: true });
  const done = await svc.verifyDeclaration({
    id: sent.id, companyId: 'c1', actor: hr, allowed: { chapter8_deductions: 150000, hra_exemption: 96000 }, note: '80C capped at the limit',
  });
  expect(done).toMatchObject({ status: 'verified', allowed: { chapter8_deductions: 150000, hra_exemption: 96000 }, hrNote: '80C capped at the limit' });
  const profile = global.__db.employees[0].salary_details.tax_profile.years[TY];
  expect(profile).toEqual({
    regime: 'old',
    earlier_income: 300000, // HR's own entries are kept
    earlier_tds: 5000,
    hra_exemption: 96000,
    chapter8_deductions: 150000,
  });
  expect(global.__db.employees[0].salary_details.basic).toBe(50000);
  expect(global.__background).toEqual(['drafts after a tax declaration']);
  // Reviewed once: it can't be reviewed again until the employee sends it again.
  await expect(svc.verifyDeclaration({ id: sent.id, companyId: 'c1', actor: hr })).rejects.toThrow(/Only a declaration sent for checking/);
});

test('accepting keeps what HR recorded and didn\'t send (a previous employer\'s salary), and an explicit 0 clears', async () => {
  global.__db.employees[0].salary_details.tax_profile.years[TY].previous_employer_income = 800000;
  global.__db.employees[0].salary_details.tax_profile.years[TY].previous_employer_tds = 20000;
  global.__db.employees[0].salary_details.tax_profile.years[TY].other_income = 5000;
  const sent = await svc.saveMyDeclaration(employee, { taxYear: TY, regime: 'new', submit: true });
  await svc.verifyDeclaration({ id: sent.id, companyId: 'c1', actor: hr, allowed: { other_income: 0 } });
  const profile = global.__db.employees[0].salary_details.tax_profile.years[TY];
  expect(profile).toMatchObject({ regime: 'new', previous_employer_income: 800000, previous_employer_tds: 20000, other_income: 0 });
});

test('HR can return it with a note, can\'t review their own, and can\'t see another company\'s', async () => {
  const sent = await svc.saveMyDeclaration(employee, { taxYear: TY, regime: 'new', submit: true });
  await expect(svc.returnDeclaration({ id: sent.id, companyId: 'c1', actor: hr, note: '  ' })).rejects.toThrow(/Say what/);
  await expect(svc.verifyDeclaration({ id: sent.id, companyId: 'c1', actor: { id: 'e1', role: 'hr' } })).rejects.toThrow(/your own/);
  await expect(svc.verifyDeclaration({ id: sent.id, companyId: 'c2', actor: hr })).rejects.toThrow(/not found/);
  const back = await svc.returnDeclaration({ id: sent.id, companyId: 'c1', actor: hr, note: 'Add your rent receipts' });
  expect(back).toMatchObject({ status: 'returned', hrNote: 'Add your rent receipts' });
  // Returned: the employee can change it again.
  expect((await svc.saveMyDeclaration(employee, { taxYear: TY, regime: 'old' })).status).toBe('draft');
});

test('before the SQL is run: a clear message, nothing else', async () => {
  global.__fail.tax_declarations = 'Could not find the table \'public.tax_declarations\' in the schema cache';
  await expect(svc.getMyDeclaration(employee)).rejects.toThrow(/one-time database update/);
  await expect(svc.listDeclarations('c1', {})).rejects.toThrow(/one-time database update/);
});
