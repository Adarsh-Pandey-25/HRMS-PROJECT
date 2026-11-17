/**
 * Payroll for every employee of the company (audit #21) and HR's own pay
 * (audit #3): the payslip list a page at a time with the whole month's
 * count, month-wide generate / approve / publish / mark paid chosen on the
 * server a batch at a time, HR's own payslip skipped or refused (an Admin's
 * allowed and audit-logged), and maker-checker on approval. The database is
 * an in-memory stand-in (eq / in / gt filters and ranges applied, every query
 * recorded); attendance, PDF, storage, audit and background work are
 * stand-ins. Nothing is sent.
 */
// Never read backend/.env (the live database's keys) in a test.
jest.mock('dotenv', () => ({ config: () => ({ parsed: {} }) }));
jest.mock('../../src/config/supabase', () => {
  const make = (table) => {
    const state = {
      filters: [], ins: [], op: 'select', payload: null, range: null, count: false,
    };
    const rows = () => global.__db[table] || [];
    const match = (r) => state.filters.every(([f, v]) => String(r[f]) === String(v))
      && state.ins.every(([f, list]) => list.map(String).includes(String(r[f])));
    const run = () => {
      global.__queries.push({ table, op: state.op, filters: [...state.filters], range: state.range });
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
      const all = rows().filter(match);
      const data = state.range ? all.slice(state.range[0], state.range[1] + 1) : all;
      return { data, error: null, count: state.count ? all.length : null };
    };
    const q = {};
    for (const m of ['order', 'gte', 'lte', 'lt', 'neq', 'limit', 'ilike', 'is', 'not', 'or']) q[m] = () => q;
    q.select = (_cols, opts) => { if (opts?.count) state.count = true; return q; };
    q.eq = (f, v) => { state.filters.push([f, v]); return q; };
    q.in = (f, list) => { state.ins.push([f, list]); return q; };
    q.gt = () => q;
    q.range = (a, b) => { state.range = [a, b]; return q; };
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
jest.mock('../../src/services/auditLog.service', () => ({ logAudit: (entry) => { global.__audit.push(entry); return Promise.resolve(); } }));
jest.mock('../../src/services/storage.service', () => ({
  uploadPayslip: async () => ({ path: 'x' }), getSignedUrl: async () => 'x', STORAGE_BUCKETS: { payslips: 'payslips' },
}));
jest.mock('../../src/services/payslipPdf.service', () => ({ buildPayslipPdfBuffer: async () => Buffer.from('%PDF') }));
jest.mock('../../src/utils/background', () => ({ runInBackground: () => {} }));
jest.mock('../../src/utils/logger', () => new Proxy({}, {
  get: (_t, prop) => (prop === '__esModule' || prop === 'then' ? undefined : () => {}),
}));
jest.mock('../../src/services/tenant.service', () => ({
  getOrgEmployeeIds: async () => (global.__db.employees || []).map((e) => e.id),
  getCompanyEmployeeIds: async () => (global.__db.employees || []).map((e) => e.id),
  getCompanyHrAdminIds: async () => [],
}));

const payroll = require('../../src/services/payroll.service');
const payment = require('../../src/services/payrollPayment.service');
const controller = require('../../src/controllers/payroll.controller');
const settingsService = require('../../src/services/settings.service');
const { selectAllPages } = require('../../src/utils/selectIn');
const { settingsKey } = require('../../src/utils/tenant');

const hr = { id: 'hr000000-0000-4000-8000-000000000001', role: 'hr', company_id: 'c1' };
const admin = { id: 'ad000000-0000-4000-8000-000000000001', role: 'admin', company_id: 'c1' };
const OWN = /Your own payslip has to be handled by an Admin/;
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const person = (pid, extra = {}) => ({
  id: pid,
  company_id: 'c1',
  is_active: true,
  gender: 'male',
  first_name: 'P',
  date_of_joining: '2024-01-01',
  salary_details: { basic: 22000, hra: 8800, special: 9200 },
  bank_details: { account_number: '001234567890', ifsc: 'HDFC0001234', bank_name: 'HDFC Bank' },
  ...extra,
});
const slip = (sid, employeeId, extra = {}) => ({
  id: sid, employee_id: employeeId, company_id: 'c1', month: 10, year: 2026, payslip_status: 'DRAFT', payment_status: 'pending', ...extra,
});

beforeEach(async () => {
  global.__queries = [];
  global.__audit = [];
  global.__db = {
    employees: [],
    payroll: [],
    payroll_months: [],
    payroll_one_time_items: [],
    salary_revisions: [],
    reimbursements: [],
    payroll_components: [],
    leave_balances: [],
    system_settings: [{ key: settingsKey('c1', 'payroll_config'), value: { pt_state: 'Karnataka', pt_state_set: true } }],
  };
  await settingsService.ensureCache(true);
});
afterAll(() => { delete global.__db; delete global.__queries; delete global.__audit; });
const flush = () => new Promise((r) => setImmediate(r));

describe('every row, however many', () => {
  test('a select is read a page at a time until a short page (2,345 rows → 3 pages)', async () => {
    const all = Array.from({ length: 2345 }, (_, i) => ({ id: i }));
    const calls = [];
    const build = () => {
      const q = { order: () => q, range: (a, b) => { calls.push([a, b]); return Promise.resolve({ data: all.slice(a, b + 1), error: null }); } };
      return q;
    };
    const { data } = await selectAllPages(build);
    expect(data).toHaveLength(2345);
    expect(calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  test('the payslip list: the company\'s column, the whole month\'s count, at most 200 a page', async () => {
    global.__db.payroll = Array.from({ length: 250 }, (_, i) => slip(id(i + 1), `e${i}`));
    global.__db.payroll.push(slip(id(999), 'x', { company_id: 'c2' }));
    const first = await payroll.listPayslips({
      month: 10, year: 2026, user: hr, role: 'hr', companyId: 'c1', pageQuery: { page: '1', limit: '1000' },
    });
    expect(first.data).toHaveLength(200);
    expect(first.meta).toMatchObject({ page: 1, limit: 200, total: 250, totalPages: 2 });
    const second = await payroll.listPayslips({
      month: 10, year: 2026, user: hr, role: 'hr', companyId: 'c1', pageQuery: { page: '2', limit: '200' },
    });
    expect(second.data).toHaveLength(50);
    const q = global.__queries.find((x) => x.table === 'payroll');
    expect(q.filters).toContainEqual(['company_id', 'c1']);
  });

  test('the list for one employee, or one status; anything else is refused', async () => {
    global.__db.payroll = [slip(id(1), 'e1'), slip(id(2), 'e2', { payslip_status: 'PUBLISHED' })];
    const one = await payroll.listPayslips({
      month: 10, year: 2026, user: hr, role: 'hr', companyId: 'c1', pageQuery: { employee_id: id(5) },
    });
    expect(one.data).toHaveLength(0);
    const published = await payroll.listPayslips({
      month: 10, year: 2026, user: hr, role: 'hr', companyId: 'c1', pageQuery: { status: 'published' },
    });
    expect(published.data.map((r) => r.id)).toEqual([id(2)]);
    await expect(payroll.listPayslips({
      month: 10, year: 2026, user: hr, role: 'hr', companyId: 'c1', pageQuery: { status: 'paid' },
    })).rejects.toThrow(/draft or published/);
  });
});

describe('who is in the month', () => {
  test('still switched on, but left before the month began: not in it', () => {
    expect(payroll.employmentInMonth({ is_active: true, last_working_day: '2026-09-15' }, 10, 2026))
      .toEqual({ employed: false, reason: 'Left before this month' });
  });

  test('generate for everyone, a batch at a time: each one employed in the month, made by the person who ran it', async () => {
    global.__db.payroll_months = [{ id: 'pm1', month: 10, year: 2026, company_id: 'c1', status: 'PENDING' }];
    global.__db.employees = [
      ...[1, 2, 3, 4, 5].map((n) => person(id(n))),
      person(id(6), { date_of_joining: '2026-11-03' }), // joins after October
      person(id(7), { last_working_day: '2026-09-30' }), // left before October, profile still on
      person(id(8), { is_active: false }), // switched off, no last day
      person(id(9), { company_id: 'c2' }), // another company
    ];
    const first = await payroll.generateMonthBatch('pm1', 'c1', { actor: hr, timeBudgetMs: 0 });
    expect(first).toMatchObject({ total: 5, done: 4, remaining: 1, next: id(4) });
    expect(first.results.filter((r) => r.status === 'generated')).toHaveLength(4);
    expect(first.results.find((r) => r.user_id === id(7))).toMatchObject({ status: 'skipped', reason: expect.stringMatching(/Left before this month/) });
    const second = await payroll.generateMonthBatch('pm1', 'c1', { actor: hr, after: first.next, timeBudgetMs: 0 });
    expect(second).toMatchObject({ total: 5, done: 5, remaining: 0, next: null });
    expect(second.results.map((r) => r.user_id)).toEqual([id(5)]);
    expect(global.__db.payroll.map((r) => r.employee_id).sort()).toEqual([1, 2, 3, 4, 5].map(id));
    expect(global.__db.payroll.every((r) => r.breakdown_json.prepared.generated_by === hr.id)).toBe(true);
    await expect(payroll.generateMonthBatch('pm1', 'c1', { after: 'not-an-id' })).rejects.toThrow(/carry on/);
  });
});

describe('publishing the month', () => {
  test('chosen on the server, a batch at a time; HR\'s own payslip is skipped with the reason', async () => {
    const other = { id: 'z', company_id: 'c2' }; // fails quickly: not this company's
    global.__db.payroll = [
      slip(id(1), hr.id, { employee: { ...person(hr.id) } }),
      ...[2, 3, 4, 5, 6].map((n) => slip(id(n), `e${n}`, { employee: other })),
      slip(id(7), 'e7', { payslip_status: 'PUBLISHED' }),
      slip(id(8), 'e8', { company_id: 'c2' }),
    ];
    const first = await payroll.publishMonth(10, 2026, hr, { timeBudgetMs: 0 });
    expect(first).toMatchObject({
      published: 0, total: 6, remaining: 2, next: id(4), ownSkipped: true,
    });
    expect(first.skipped[0]).toEqual({
      payslipId: id(1), employeeId: hr.id, reason: 'Your payslip was skipped — an Admin has to publish it.', own: true,
    });
    const second = await payroll.publishMonth(10, 2026, hr, { after: first.next, timeBudgetMs: 0 });
    expect(second).toMatchObject({ remaining: 0, next: null, ownSkipped: false });
    expect(second.skipped.map((s) => s.payslipId)).toEqual([id(5), id(6)]);
    // Only the company's drafts of the month were read.
    const reads = global.__queries.filter((q) => q.table === 'payroll' && q.range);
    expect(reads[0].filters).toEqual(expect.arrayContaining([['company_id', 'c1'], ['month', 10], ['year', 2026], ['payslip_status', 'DRAFT']]));
  });

  test('one payslip: HR can\'t publish their own; an Admin\'s own gets past that check', async () => {
    global.__db.payroll = [slip(id(1), hr.id, { employee: person(hr.id) }), slip(id(2), admin.id, { employee: person(admin.id) })];
    await expect(payroll.publishPayslip(id(1), hr)).rejects.toThrow(OWN);
    // Upper-case ids are the same person.
    await expect(payroll.publishPayslip(id(1), { ...hr, id: hr.id.toUpperCase() })).rejects.toThrow(OWN);
    await expect(payroll.publishPayslip(id(2), admin)).rejects.toThrow(/earlier payroll calculation/);
    const r = await payroll.publishMonth(10, 2026, admin, { timeBudgetMs: 0 });
    expect(r.ownSkipped).toBe(false);
  });
});

describe('approving the month (approval before publishing)', () => {
  const draft = (sid, employeeId, extra = {}) => slip(sid, employeeId, {
    employee: person(employeeId), approved_by: null, approved_figures: null, breakdown_json: { config: { engine: 2 } }, ...extra,
  });

  test('nobody approves their own payslip — it is skipped, for an Admin too', async () => {
    global.__db.payroll = [draft(id(1), admin.id)];
    const r = await payroll.approveMonth(10, 2026, admin, { timeBudgetMs: 0 });
    expect(r).toMatchObject({ approved: 0, ownSkipped: true, next: null });
    expect(r.skipped[0]).toMatchObject({ own: true, reason: 'Your payslip was skipped — someone else has to approve it.' });
  });

  test('maker-checker: whoever generated the draft, last changed it or added pay to it can\'t approve it', async () => {
    global.__db.employees = [person('e1')];
    global.__db.payroll = [
      draft(id(1), 'e1', { breakdown_json: { config: { engine: 2 }, prepared: { generated_by: hr.id } } }),
      draft(id(2), 'e1', { month: 9, breakdown_json: { config: { engine: 2 }, prepared: { generated_by: null, edited_by: hr.id.toUpperCase() } } }),
      draft(id(3), 'e1', { month: 8, breakdown_json: { config: { engine: 2 } } }),
    ];
    global.__db.payroll_one_time_items = [{ employee_id: 'e1', month: 8, year: 2026, status: 'active', created_by: hr.id }];
    for (const n of [1, 2, 3]) {
      // eslint-disable-next-line no-await-in-loop
      await expect(payroll.approvePayslip(id(n), hr)).rejects.toThrow(/generated or changed this payslip, so someone else has to approve it/);
    }
    // Someone else gets past that check (on to checking the figures).
    await expect(payroll.approvePayslip(id(3), admin)).rejects.not.toThrow(/generated or changed/);
  });
});

describe('marking the month paid', () => {
  const today = require('moment-timezone').tz('Asia/Kolkata').format('YYYY-MM-DD');
  const published = (n, employeeId, extra = {}) => slip(id(n), employeeId, { payslip_status: 'PUBLISHED', ...extra });

  test('every published, unpaid payslip of the month — chosen on the server; HR\'s own is left out', async () => {
    global.__db.payroll = [
      published(1, hr.id),
      ...[2, 3, 4].map((n) => published(n, `e${n}`)),
      published(5, 'e5', { payment_status: 'paid' }),
      slip(id(6), 'e6'), // a draft
      published(7, 'e7', { company_id: 'c2' }),
      published(8, 'e8', { month: 9 }),
    ];
    const r = await payment.markPaidMonth({
      companyId: 'c1', month: 10, year: 2026, paidOn: today, reference: 'UTR123456', actor: hr,
    });
    expect(r).toMatchObject({ updated: 3, alreadyPaid: 1, ownSkipped: true, referenceStored: true });
    expect(r.skipped).toEqual([{
      payslipId: id(1), employeeId: hr.id, reason: 'Your payslip was skipped — an Admin has to mark it paid.', own: true,
    }]);
    expect(global.__db.payroll.filter((s) => s.payment_status === 'paid').map((s) => s.id).sort()).toEqual([2, 3, 4, 5].map(id));
    await expect(payment.markPaidMonth({
      companyId: 'c1', month: 10, year: 2026, paidOn: '2026-09-30', reference: 'UTR123456', actor: hr,
    })).rejects.toThrow(/before the payslip's month/);
  });

  test('an Admin\'s own is marked with the rest, and audit-logged', async () => {
    global.__db.payroll = [published(1, admin.id), published(2, 'e2')];
    const r = await payment.markPaidMonth({
      companyId: 'c1', month: 10, year: 2026, paidOn: today, reference: 'UTR123456', actor: admin,
    });
    expect(r).toMatchObject({ updated: 2, ownSkipped: false });
    await flush();
    expect(global.__audit.some((a) => a.actionType === 'payroll.own_pay.mark_paid')).toBe(true);
  });

  test('a chosen list: HR\'s own among others is left out; on its own it is refused', async () => {
    global.__db.payroll = [published(1, hr.id), published(2, 'e2')];
    const r = await payment.markPaid({
      companyId: 'c1', payslipIds: [id(1), id(2)], paidOn: today, reference: 'UTR123456', actor: hr,
    });
    expect(r).toMatchObject({ updated: 1, ownSkipped: true });
    await expect(payment.markPaid({
      companyId: 'c1', payslipIds: [id(1)], paidOn: today, reference: 'UTR123456', actor: hr,
    })).rejects.toThrow(OWN);
  });
});

describe('downloading a payslip', () => {
  test('its payroll month is always the caller\'s own company\'s', async () => {
    global.__db.payroll = [slip(id(1), 'e1', { payslip_status: 'PUBLISHED', payroll_month_id: 'pm-other', employee: person('e1') })];
    global.__db.payroll_months = [
      { id: 'pm-other', month: 10, year: 2026, company_id: 'c2' },
      { id: 'pm-c2', month: 10, year: 2026, company_id: 'c2' },
    ];
    await payroll.downloadPayslip(id(1), hr);
    const months = global.__queries.filter((q) => q.table === 'payroll_months');
    expect(months).toHaveLength(2);
    for (const q of months) expect(q.filters).toContainEqual(['company_id', 'c1']);
  });
});

describe('downloading someone else\'s payslip needs Payroll → Manage (#9)', () => {
  test('refused for HR once an Admin unticks it; their own is still fine', async () => {
    const rolePermissions = require('../../src/services/rolePermissions.service');
    const spy = jest.spyOn(rolePermissions, 'can').mockResolvedValue(false);
    try {
      global.__db.payroll = [
        slip(id(1), 'e1', { payslip_status: 'PUBLISHED', payroll_month_id: 'pm-c1', employee: person('e1') }),
        slip(id(2), hr.id, { payslip_status: 'PUBLISHED', payroll_month_id: 'pm-c1', employee: person(hr.id) }),
      ];
      global.__db.payroll_months = [{ id: 'pm-c1', month: 10, year: 2026, company_id: 'c1' }];
      await expect(payroll.downloadPayslip(id(1), hr)).rejects.toThrow(/permission to open other people/);
      await expect(payroll.downloadPayslip(id(2), hr)).resolves.toBeDefined();
    } finally {
      spy.mockRestore();
    }
  });
});

describe('the screens\' requests: HR acting on their own pay', () => {
  const call = async (handler, req) => {
    let error = null;
    let body = null;
    const res = {
      status: () => res, json: (b) => { body = b; return res; }, setHeader: () => {}, send: () => res,
    };
    await handler({ ip: '127.0.0.1', params: {}, query: {}, body: {}, ...req }, res, (e) => { error = e; });
    return { error, body };
  };

  test('generating or recalculating one\'s own payslip is refused for HR, allowed and audit-logged for an Admin', async () => {
    global.__db.employees = [person(hr.id), person(admin.id)];
    global.__db.payroll_months = [{ id: 'pm1', month: 10, year: 2026, company_id: 'c1', status: 'PENDING' }];
    const gen = await call(controller.generatePayslip, { user: hr, body: { payroll_month_id: 'pm1', user_id: hr.id } });
    expect(gen.error?.message).toMatch(OWN);
    const recalc = await call(controller.recalculateFromSettings, { user: hr, body: { employee_id: hr.id } });
    expect(recalc.error?.message).toMatch(OWN);
    const mine = await call(controller.generatePayslip, { user: admin, body: { payroll_month_id: 'pm1', user_id: admin.id } });
    expect(mine.error).toBeNull();
    expect(mine.body.data.employee_id).toBe(admin.id);
    await flush();
    expect(global.__audit.some((a) => a.actionType === 'payroll.own_pay.generate')).toBe(true);
    // Their own draft records who made it.
    expect(global.__db.payroll[0].breakdown_json.prepared.generated_by).toBe(admin.id);
  });

  test('HR can\'t make their own final payslip', async () => {
    global.__db.employees = [person(hr.id)];
    const r = await call(controller.generateFinalPayslip, { user: hr, params: { employeeId: hr.id } });
    expect(r.error?.message).toMatch(OWN);
  });

  test('one-time pay: HR can\'t add or remove their own; an Admin can, audit-logged', async () => {
    const oneTime = require('../../src/services/oneTimePay.service');
    global.__db.employees = [person(hr.id), person(admin.id)];
    await expect(oneTime.createItem({
      companyId: 'c1', employeeId: hr.id, actor: hr, month: 10, year: 2026, kind: 'bonus', amount: 1000,
    })).rejects.toThrow(OWN);
    await expect(oneTime.cancelItem({
      companyId: 'c1', employeeId: hr.id, actor: hr, itemId: 'x',
    })).rejects.toThrow(OWN);
    const made = await oneTime.createItem({
      companyId: 'c1', employeeId: admin.id, actor: admin, month: 10, year: 2026, kind: 'bonus', amount: 1000,
    });
    expect(made).toMatchObject({ kind: 'bonus', amount: 1000 });
    await flush();
    expect(global.__audit.some((a) => a.actionType === 'payroll.own_pay.one_time.create')).toBe(true);
  });

  test('publish and mark paid for the month answer with counts', async () => {
    global.__db.payroll = [slip(id(1), hr.id, { employee: person(hr.id) })];
    const pub = await call(controller.publishMonth, { user: hr, body: { month: 10, year: 2026 } });
    expect(pub.body.data).toMatchObject({ published: 0, ownSkipped: true, next: null });
    const paid = await call(controller.markPaidMonth, {
      user: hr, body: { month: 10, year: 2026, paidOn: '2026-11-01', reference: 'UTR123456' },
    });
    expect(paid.body.data).toMatchObject({ updated: 0, alreadyPaid: 0 });
  });
});
