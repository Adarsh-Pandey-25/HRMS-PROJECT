/**
 * The role permission matrix enforced on real routes: the route files are
 * mounted as the app mounts them, with sign-in, plan features and the
 * controllers replaced by stand-ins (a controller just answers 200). No
 * database; nothing is sent.
 */
// Never read backend/.env (the live database's keys) in a test.
jest.mock('dotenv', () => ({ config: () => ({ parsed: {} }) }));
jest.mock('../../src/config/supabase', () => ({ supabaseAdmin: { from: () => { throw new Error('no database in these tests'); } } }));
jest.mock('../../src/utils/logger', () => new Proxy({}, {
  get: (_t, prop) => (prop === '__esModule' || prop === 'then' ? undefined : () => {}),
}));
jest.mock('../../src/services/settings.service', () => ({
  getSetting: jest.fn(async (key, fallback) => (key in global.__settings ? global.__settings[key] : fallback)),
}));
// Signed in as whoever the test says (header x-test-user).
jest.mock('../../src/middleware/auth.middleware', () => ({
  authenticate: (req, res, next) => { req.user = JSON.parse(req.headers['x-test-user']); next(); },
}));
jest.mock('../../src/middleware/featureGate.middleware', () => ({ requireFeature: () => (req, res, next) => next() }));
jest.mock('../../src/middleware/apiKey.middleware', () => ({ requireApiScope: () => (req, res, next) => next() }));
jest.mock('../../src/middleware/ipValidation.middleware', () => ({ attachClientIp: (req, res, next) => next() }));
const answer = () => new Proxy({}, {
  get: (_t, prop) => (prop === '__esModule' || prop === 'then' ? undefined : (req, res) => res.json({ ok: true, handler: String(prop) })),
});
jest.mock('../../src/controllers/payroll.controller', () => answer());
jest.mock('../../src/controllers/salaryRevision.controller', () => answer());
jest.mock('../../src/controllers/attendance.controller', () => answer());
jest.mock('../../src/controllers/adms.controller', () => answer());
jest.mock('../../src/controllers/wfhRequest.controller', () => answer());
jest.mock('../../src/controllers/leave.controller', () => answer());
jest.mock('../../src/controllers/settings.controller', () => answer());
jest.mock('../../src/controllers/company.controller', () => answer());

const express = require('express');
const request = require('supertest');

const app = express();
app.use(express.json());
app.use('/api/payroll', require('../../src/routes/payroll.routes'));
app.use('/api/attendance', require('../../src/routes/attendance.routes'));
app.use('/api/leaves', require('../../src/routes/leave.routes'));
app.use('/api/settings', require('../../src/routes/settings.routes'));
app.use('/api/companies', require('../../src/routes/company.routes'));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => res.status(err.statusCode || 500).json({ message: err.message }));

const HR_ID = 'aaaaaaaa-1111-4111-8111-111111111111';
const EMP_ID = 'bbbbbbbb-2222-4222-8222-222222222222';
const MGR_ID = 'cccccccc-3333-4333-8333-333333333333';
const OTHER_ID = 'dddddddd-4444-4444-8444-444444444444';
const hr = { id: HR_ID, role: 'hr', company_id: 'c1' };
const employee = { id: EMP_ID, role: 'employee', company_id: 'c1' };
const manager = { id: MGR_ID, role: 'manager', company_id: 'c1' };
const admin = { id: 'eeeeeeee-5555-4555-8555-555555555555', role: 'admin', company_id: 'c1' };

const as = (user) => ({
  get: (url) => request(app).get(url).set('x-test-user', JSON.stringify(user)),
  put: (url, body = {}) => request(app).put(url).set('x-test-user', JSON.stringify(user)).send(body),
  post: (url, body = {}) => request(app).post(url).set('x-test-user', JSON.stringify(user)).send(body),
});
const month = '?month=10&year=2026';

beforeEach(() => { global.__settings = {}; });

describe('payroll', () => {
  test('HR keeps payroll by default', async () => {
    expect((await as(hr).get(`/api/payroll/bank-file${month}`)).status).toBe(200);
    expect((await as(hr).get('/api/payroll/revisions')).status).toBe(200);
    expect((await as(hr).get(`/api/payroll/payslips${month}`)).status).toBe(200);
  });

  test('once an Admin unticks HR → Payroll → Manage, HR can\'t reach it through the API', async () => {
    global.__settings.role_permissions = { hr: { payroll: { view: true, manage: false } } };
    const bank = await as(hr).get(`/api/payroll/bank-file${month}`);
    expect(bank.status).toBe(403);
    expect(bank.body.message).toMatch(/Payroll Processing.*Settings → User & Role Management/);
    expect((await as(hr).post('/api/payroll/payslips/generate', {})).status).toBe(403);
    expect((await as(hr).get('/api/payroll/revisions')).status).toBe(403);
    expect((await as(hr).post(`/api/payroll/loans/${OTHER_ID}/${OTHER_ID}/cancel`)).status).toBe(403);
    // The company's payslip list and another person's salary are management too.
    expect((await as(hr).get(`/api/payroll/payslips${month}`)).status).toBe(403);
    expect((await as(hr).get(`/api/payroll/salary-preview/${OTHER_ID}`)).status).toBe(403);
  });

  test('HR\'s own payslips, tax and loans never need the matrix', async () => {
    global.__settings.role_permissions = { hr: { payroll: { view: false, manage: false } } };
    expect((await as(hr).get(`/api/payroll/payslips${month}&mine=true`)).status).toBe(200);
    expect((await as(hr).get(`/api/payroll/salary-preview/${HR_ID}`)).status).toBe(200);
    expect((await as(hr).get(`/api/payroll/salary-preview/${HR_ID.toUpperCase()}`)).status).toBe(200);
    expect((await as(hr).get('/api/payroll/tax-declaration/me')).status).toBe(200);
    expect((await as(hr).get('/api/payroll/loans/me')).status).toBe(200);
    expect((await as(hr).get('/api/payroll/tds/statement/me')).status).toBe(200);
  });

  test('Admin always passes, even with a broken matrix saved', async () => {
    global.__settings.role_permissions = [];
    expect((await as(admin).get(`/api/payroll/bank-file${month}`)).status).toBe(200);
    expect((await as(hr).get(`/api/payroll/bank-file${month}`)).status).toBe(403);
  });
});

describe('employee self-service', () => {
  test('an employee keeps their own payslips, attendance and leave whatever the matrix says', async () => {
    global.__settings.role_permissions = {
      employee: {
        payroll: { view: false }, attendance: { view: false }, leave: { view: false, create: false, approve: false },
      },
    };
    expect((await as(employee).get(`/api/payroll/payslips${month}`)).status).toBe(200);
    expect((await as(employee).get(`/api/payroll/salary-preview/${EMP_ID}`)).status).toBe(200);
    expect((await as(employee).get(`/api/attendance/report/${EMP_ID}`)).status).toBe(200);
    expect((await as(employee).get(`/api/attendance/report/${EMP_ID.toUpperCase()}`)).status).toBe(200);
    expect((await as(employee).get('/api/attendance/my-attendance')).status).toBe(200);
    expect((await as(employee).get('/api/attendance/wfh-requests/mine')).status).toBe(200);
    expect((await as(employee).get(`/api/leaves/balance/${EMP_ID}`)).status).toBe(200);
    expect((await as(employee).get('/api/leaves/my-leaves')).status).toBe(200);
    expect((await as(employee).post('/api/leaves/apply', {})).status).not.toBe(403);
  });
});

describe('attendance and leave', () => {
  test('HR without Attendance → View can\'t read others\' attendance, but still their own', async () => {
    expect((await as(hr).get('/api/attendance/all-attendance')).status).toBe(200);
    global.__settings.role_permissions = { hr: { attendance: { view: false, approve: true, manage: true } } };
    expect((await as(hr).get('/api/attendance/all-attendance')).status).toBe(403);
    expect((await as(hr).get(`/api/attendance/report/${OTHER_ID}`)).status).toBe(403);
    expect((await as(hr).get(`/api/attendance/report/${HR_ID}`)).status).toBe(200);
  });

  test('a manager approves leave by default, and not once an Admin unticks it', async () => {
    expect((await as(manager).put(`/api/leaves/${OTHER_ID}/approve`)).status).toBe(200);
    global.__settings.role_permissions = { manager: { leave: { approve: false } } };
    expect((await as(manager).put(`/api/leaves/${OTHER_ID}/approve`)).status).toBe(403);
    expect((await as(manager).get(`/api/leaves/balance/${MGR_ID}`)).status).toBe(200);
  });

  test('an API key can\'t read someone\'s attendance report', async () => {
    const key = { id: null, role: 'api_key', company_id: 'c1' };
    expect((await as(key).get(`/api/attendance/report/${OTHER_ID}`)).status).toBe(403);
  });
});

describe('settings and companies', () => {
  test('HR without Settings → Manage can\'t change settings, but Shifts still save', async () => {
    global.__settings.role_permissions = { hr: { settings: { view: true, manage: false } } };
    expect((await as(hr).put('/api/settings/expense_config', { value: {} })).status).toBe(403);
    expect((await as(hr).put('/api/settings/attendance_config', { value: {} })).status).toBe(200);
    expect((await as(hr).get('/api/settings/leave-policy')).status).toBe(200);
  });

  test('HR adds or edits companies only once an Admin allows it', async () => {
    expect((await as(hr).post('/api/companies/children', { name: 'Sub Co' })).status).toBe(403);
    expect((await as(hr).get(`/api/companies/${OTHER_ID}/details`)).status).toBe(200);
    global.__settings.role_permissions = { hr: { organizations: { view: true, create: true, edit: false } } };
    expect((await as(hr).post('/api/companies/children', { name: 'Sub Co' })).status).toBe(200);
    expect((await as(admin).post('/api/companies/children', { name: 'Sub Co' })).status).toBe(200);
    expect((await as(manager).post('/api/companies/children', { name: 'Sub Co' })).status).toBe(403);
  });
});
