/**
 * Approval before publishing (maker-checker), a company choice: a second
 * person approves the exact figures; a changed draft needs approving again;
 * whoever approved can't publish. The database, attendance and the PDF are
 * stand-ins: building the PDF stops the publish, so nothing is uploaded,
 * stored or sent — reaching it means the approval check let it through.
 */
// Never read backend/.env (the live database's keys) in a test.
jest.mock('dotenv', () => ({ config: () => ({ parsed: {} }) }));
jest.mock('../../src/config/supabase', () => {
  const builder = (table) => {
    const rows = () => global.__mockTables?.[table] || [];
    const q = { patch: null };
    for (const m of ['select', 'eq', 'neq', 'in', 'gte', 'lte', 'gt', 'lt', 'order', 'range', 'limit', 'is', 'not', 'or', 'ilike']) q[m] = () => q;
    q.update = (patch) => { q.patch = patch; global.__updates.push({ table, patch }); return q; };
    q.insert = () => q;
    q.maybeSingle = () => Promise.resolve({ data: q.patch ? { id: rows()[0]?.id } : (rows()[0] ?? null), error: null });
    q.single = q.maybeSingle;
    q.then = (resolve, reject) => Promise.resolve({ data: rows(), error: null }).then(resolve, reject);
    return q;
  };
  return { supabaseAdmin: { from: (t) => builder(t), rpc: () => Promise.resolve({ data: null, error: null }) } };
});
jest.mock('../../src/services/attendance.service', () => ({
  getMonthlySummary: async () => ({ summary: { workingDays: 22, absent: 0, halfDay: 0, late: 0 }, records: [] }),
}));
const quiet = () => new Proxy({}, { get: (_t, prop) => (prop === '__esModule' || prop === 'then' ? undefined : () => Promise.resolve()) });
jest.mock('../../src/services/email.service', () => quiet());
jest.mock('../../src/services/notification.service', () => quiet());
jest.mock('../../src/services/auditLog.service', () => ({ logAudit: () => Promise.resolve(), auditFromRequest: () => {} }));
jest.mock('../../src/services/storage.service', () => ({
  uploadPayslip: async () => { throw new Error('nothing may be uploaded in this test'); },
  getSignedUrl: async () => 'x',
  getSignedUrlForPath: async () => null,
  STORAGE_BUCKETS: { payslips: 'payslips' },
}));
jest.mock('../../src/services/payslipPdf.service', () => ({
  buildPayslipPdfBuffer: async () => { throw new Error('STOP: past the approval check'); },
}));
jest.mock('../../src/utils/logger', () => new Proxy({}, {
  get: (_t, prop) => (prop === '__esModule' || prop === 'then' ? undefined : () => {}),
}));

const payroll = require('../../src/services/payroll.service');
const settingsService = require('../../src/services/settings.service');
const { settingsKey } = require('../../src/utils/tenant');

const employee = {
  id: 'e1',
  company_id: 'c1',
  is_active: true,
  gender: 'male',
  first_name: 'Asha',
  salary_details: { basic: 22000, hra: 8800, special: 9200 },
  bank_details: { account_number: '001234567890', ifsc: 'HDFC0001234', bank_name: 'HDFC Bank' },
};
const hr = { id: 'h1', role: 'hr', company_id: 'c1' };
const admin = { id: 'a1', role: 'admin', company_id: 'c1' };
const STOP = /STOP: past the approval check/;

const settings = (approvalRequired) => [
  { key: settingsKey('c1', 'payroll_config'), value: { pt_state: 'Karnataka', pt_state_set: true } },
  { key: settingsKey('c1', 'payroll_calc'), value: { approval: { required: approvalRequired } } },
];
const draftRow = async (extra = {}) => {
  const calc = await payroll.calculateContractPayslip(employee, { workingDays: 22 }, 10, { year: 2026, withHistory: true });
  return {
    id: 'p1', employee_id: 'e1', company_id: 'c1', month: 10, year: 2026, payslip_status: 'DRAFT', payroll_month_id: 'pm1',
    employee, ...calc, approved_by: null, approved_at: null, approved_figures: null, ...extra,
  };
};
const setTables = (row, approvalRequired) => {
  global.__mockTables = {
    payroll: [row],
    payroll_months: [{ id: 'pm1', month: 10, year: 2026, company_id: 'c1', status: 'PENDING' }],
    employees: [employee],
    salary_revisions: [],
    reimbursements: [],
    payroll_components: [],
    system_settings: settings(approvalRequired),
  };
  // The settings are cached for a minute; a saved setting refreshes the cache, so do the same here.
  return settingsService.ensureCache(true);
};


/** The company's settings first (the draft is worked out with them), then its draft in the table. */
const prepare = async (approvalRequired, edit = (r) => r) => {
  await setTables({}, approvalRequired);
  const row = edit(await draftRow());
  await setTables(row, approvalRequired);
  return row;
};

beforeEach(() => { global.__updates = []; });
afterAll(() => { delete global.__mockTables; delete global.__updates; });

test('approval off: publishing goes ahead as before', async () => {
  await prepare(false);
  await expect(payroll.publishPayslip('p1', hr)).rejects.toThrow(STOP);
});

test('approval on: a draft nobody approved cannot be published', async () => {
  await prepare(true);
  await expect(payroll.publishPayslip('p1', hr)).rejects.toThrow(/needs to be approved/);
});

test('approved by one person, published by another, never by the same one', async () => {
  const row = await prepare(true);
  await payroll.approvePayslip('p1', admin);
  const update = global.__updates.find((u) => u.table === 'payroll' && u.patch.approved_by);
  expect(update.patch).toMatchObject({ approved_by: 'a1' });
  Object.assign(row, update.patch);
  expect(payroll.mapPayslipRow(row).approval_current).toBe(true);
  await expect(payroll.publishPayslip('p1', admin)).rejects.toThrow(/someone else has to publish/);
  await expect(payroll.publishPayslip('p1', hr)).rejects.toThrow(STOP);
});

test('a draft that changed after it was approved must be approved again', async () => {
  const row = await prepare(true);
  await payroll.approvePayslip('p1', admin);
  const { patch } = global.__updates.find((u) => u.patch.approved_by);
  // Approved when the net was ₹1 more (the draft was recalculated since).
  const figures = JSON.parse(patch.approved_figures);
  figures[2] += 100;
  Object.assign(row, patch, { approved_figures: JSON.stringify(figures) });
  expect(payroll.mapPayslipRow(row).approval_current).toBe(false);
  await expect(payroll.publishPayslip('p1', hr)).rejects.toThrow(/changed after it was approved/);
});

test('before the SQL is run: approving says what to do, and so does publishing when approval is on', async () => {
  await prepare(true, (row) => {
    const r = { ...row };
    delete r.approved_by;
    delete r.approved_at;
    delete r.approved_figures;
    return r;
  });
  await expect(payroll.approvePayslip('p1', admin)).rejects.toThrow(/run the SQL file 20261104_payroll_approval.sql/);
  await expect(payroll.publishPayslip('p1', hr)).rejects.toThrow(/run the SQL file 20261104_payroll_approval.sql/);
});

test('only a draft of the approver own company can be approved', async () => {
  await prepare(true);
  await expect(payroll.approvePayslip('p1', { id: 'x1', role: 'admin', company_id: 'c2' })).rejects.toThrow(/not found/);
  global.__mockTables.payroll[0].payslip_status = 'PUBLISHED';
  await expect(payroll.approvePayslip('p1', admin)).rejects.toThrow(/already published/);
});

test('nobody approves their own payslip (review, 3 Nov)', async () => {
  await prepare(true);
  await expect(payroll.approvePayslip('p1', { id: 'e1', role: 'hr', company_id: 'c1' })).rejects.toThrow(/your own payslip/);
});

test('an employer-side change after approval (employer ESI, PF, …) needs approving again (review, 3 Nov)', async () => {
  const row = await prepare(true);
  await payroll.approvePayslip('p1', admin);
  Object.assign(row, global.__updates.find((u) => u.patch.approved_by).patch);
  // The company now pays employer PF at 10%: the employee's figures are the same, the employer's aren't.
  global.__mockTables.system_settings = [
    ...settings(true).filter((s) => !/payroll_calc/.test(s.key)),
    { key: settingsKey('c1', 'payroll_calc'), value: { approval: { required: true }, pf: { employerRate: 10 } } },
  ];
  await settingsService.ensureCache(true);
  await expect(payroll.publishPayslip('p1', hr)).rejects.toThrow(/changed after it was approved/);
});
