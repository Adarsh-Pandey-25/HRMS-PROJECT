/**
 * Audit #10: when the parent company is suspended, its subsidiaries' people
 * are locked out too, with the same message the parent's people get. Runs
 * the real auth middleware against an in-memory database; nothing is sent
 * and backend/.env is never read.
 */
jest.mock('dotenv', () => ({ config: () => ({ parsed: {} }) }));
jest.mock('../../src/config/supabase', () => require('./subsidiary-fakeDb'));
jest.mock('../../src/utils/logger', () => new Proxy({}, {
  get: (_t, prop) => (prop === '__esModule' || prop === 'then' ? undefined : () => {}),
}));
jest.mock('../../src/services/email.service', () => new Proxy({}, {
  get: (_t, prop) => (prop === '__esModule' || prop === 'then' ? undefined : () => Promise.resolve()),
}));

process.env.JWT_SECRET = 'test-only-secret';

const jwt = require('jsonwebtoken');
const { reset, db } = require('./subsidiary-fakeDb');
const subscriptionService = require('../../src/services/subscription.service');
const { authenticate } = require('../../src/middleware/auth.middleware');

const SUSPENDED = 'Your company\'s subscription is suspended. Please contact billing.';

const employee = (id, companyId) => ({
  id, company_id: companyId, is_active: true, role: 'employee', token_version: 0,
  first_name: 'A', last_name: 'B', email: `${id}@example.test`, address: {},
});

/** Runs authenticate() for this employee; resolves with what it passed to next(). */
const signIn = (employeeId) => new Promise((resolve) => {
  const token = jwt.sign({ id: employeeId, token_version: 0 }, process.env.JWT_SECRET, { expiresIn: '5m' });
  const req = { cookies: { accessToken: token }, headers: {} };
  authenticate(req, {}, (err) => resolve({ err: err || null, user: req.user || null }));
});

beforeEach(() => {
  subscriptionService.clearBillingCache();
  reset({
    companies: [
      { id: 'p', name: 'Parent Co', parent_company_id: null },
      { id: 'c', name: 'Child Co', parent_company_id: 'p' },
      { id: 'x', name: 'Other Co', parent_company_id: null },
    ],
    company_billing_subscriptions: [
      { id: 'sub-p', company_id: 'p', plan_id: 'plan', status: 'active', created_at: '2026-01-01' },
      { id: 'sub-x', company_id: 'x', plan_id: 'plan', status: 'active', created_at: '2026-01-01' },
    ],
    employees: [employee('in-parent', 'p'), employee('in-child', 'c'), employee('elsewhere', 'x')],
  });
});

test('parent in good standing: subsidiary people get in', async () => {
  const { err, user } = await signIn('in-child');
  expect(err).toBeNull();
  expect(user.company_id).toBe('c');
});

test('parent suspended: subsidiary people are blocked with the same message as the parent\'s', async () => {
  db.tables.company_billing_subscriptions[0].status = 'suspended';

  const parent = await signIn('in-parent');
  const child = await signIn('in-child');
  expect(parent.err.statusCode).toBe(403);
  expect(parent.err.message).toBe(SUSPENDED);
  expect(child.err.statusCode).toBe(403);
  expect(child.err.message).toBe(SUSPENDED);

  // An unrelated company is untouched.
  expect((await signIn('elsewhere')).err).toBeNull();
});

test("a subsidiary's own suspended (old) subscription still blocks it", async () => {
  db.tables.company_billing_subscriptions.push({ id: 'sub-c', company_id: 'c', plan_id: 'plan', status: 'suspended', created_at: '2026-02-01' });
  expect((await signIn('in-child')).err.message).toBe(SUSPENDED);
  expect((await signIn('in-parent')).err).toBeNull();
});

test('a loop in the parent links blocks the company instead of letting it through', async () => {
  db.tables.companies.push({ id: 'loop', name: 'Loop', parent_company_id: 'loop' });
  db.tables.employees.push(employee('in-loop', 'loop'));
  const { err } = await signIn('in-loop');
  expect(err.statusCode).toBe(403);
});
