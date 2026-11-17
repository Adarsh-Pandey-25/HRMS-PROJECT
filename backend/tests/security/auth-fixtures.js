/**
 * Shared people and companies for the auth tests, plus test-only secrets.
 * The secrets are made up here; backend/.env is never read (dotenv is stubbed
 * in every auth test).
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { createFakeDb } = require('./auth-fakeDb');

process.env.JWT_SECRET = 'test-only-access-secret';
process.env.JWT_REFRESH_SECRET = 'test-only-refresh-secret';
process.env.SUPER_ADMIN_2FA_ENC_KEY = Buffer.alloc(32, 7).toString('base64');

// auth.service.js starts a cleanup interval when it loads; don't let it keep
// the test run alive.
const realSetInterval = global.setInterval;
global.setInterval = (...args) => {
  const timer = realSetInterval(...args);
  if (timer && typeof timer.unref === 'function') timer.unref();
  return timer;
};

const C1 = '11111111-1111-4111-8111-111111111111';
const C1_CHILD = '11111111-2222-4222-8222-222222222222';
const C2 = '33333333-3333-4333-8333-333333333333';

/** Parent company C1 also manages its child company; C2 is unrelated. */
const ORG = { [C1]: [C1, C1_CHILD], [C1_CHILD]: [C1_CHILD], [C2]: [C2] };

const PASSWORD = 'Old-Passw0rd!';
const PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 4);

/** The one fake database every auth test file shares with its Supabase stand-in. */
const db = createFakeDb();

const newId = () => crypto.randomUUID();

const makeEmployee = (overrides = {}) => ({
  id: newId(),
  email: `${crypto.randomBytes(4).toString('hex')}@example.test`,
  first_name: 'Test',
  last_name: 'Person',
  role: 'employee',
  company_id: C1,
  is_active: true,
  password_hash: PASSWORD_HASH,
  token_version: 0,
  two_fa_enabled: false,
  totp_secret: null,
  totp_last_used_step: null,
  must_change_password: false,
  ...overrides,
});

const seed = (employees, extra = {}) => db.reset({
  companies: [{ id: C1, is_active: true }, { id: C1_CHILD, is_active: true }, { id: C2, is_active: true }],
  company_billing_subscriptions: [
    { company_id: C1, status: 'active' },
    { company_id: C1_CHILD, status: 'active' },
    { company_id: C2, status: 'active' },
  ],
  employees,
  refresh_tokens: [],
  two_fa_login_challenges: [],
  ...extra,
});

const employeeRow = (id) => db.find('employees', (e) => e.id === id);
const refreshRowsFor = (id) => db.rows('refresh_tokens').filter((r) => r.employee_id === id);

/** A fake Express response that records cookies and the JSON body. */
const fakeRes = () => {
  const res = { cookies: {}, statusCode: 200, body: null };
  res.cookie = (name, value) => { res.cookies[name] = value; return res; };
  res.clearCookie = (name) => { res.cookies[name] = null; return res; };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
};

/** Runs a controller handler and resolves to { res, error }. */
const runHandler = async (handler, req) => {
  const res = fakeRes();
  let error = null;
  await handler({ body: {}, params: {}, cookies: {}, headers: {}, get: () => 'localhost', ip: '127.0.0.1', ...req }, res, (err) => { error = err || null; });
  return { res, error };
};

module.exports = {
  C1, C1_CHILD, C2, ORG, PASSWORD, db, newId, makeEmployee, seed, employeeRow, refreshRowsFor, fakeRes, runHandler,
};
