/**
 * Audit #30: switching a company off in the super-admin console only set a
 * flag — its people kept working on the sessions they had, and refresh kept
 * minting new ones forever. Now every request and every refresh checks the
 * company (and the company above it), and switching it off ends their
 * sessions. In-memory database only.
 */
jest.mock('dotenv', () => ({ config: () => ({ parsed: {} }) }));
jest.mock('../../src/config/supabase', () => ({ supabaseAdmin: require('./auth-fixtures').db.client }));
jest.mock('../../src/utils/logger', () => new Proxy({}, {
  get: (_t, prop) => (prop === '__esModule' || prop === 'then' ? undefined : () => {}),
}));
jest.mock('../../src/services/email.service', () => new Proxy({}, { get: () => jest.fn(() => Promise.resolve({ success: true })) }));
jest.mock('../../src/services/auditLog.service', () => ({ logAudit: jest.fn(() => Promise.resolve()), auditFromRequest: jest.fn() }));
jest.mock('../../src/services/tenant.service', () => ({
  getOrgCompanyIds: jest.fn(async (id) => require('./auth-fixtures').ORG[id] || [id]),
}));

const fx = require('./auth-fixtures');
const authService = require('../../src/services/auth.service');
const superAdminService = require('../../src/services/superAdmin.service');
const { authenticate } = require('../../src/middleware/auth.middleware');

const { db, PASSWORD, C1, C1_CHILD } = fx;

const checkAccess = async (accessToken) => {
  let outcome;
  await authenticate({ cookies: { accessToken }, headers: {} }, {}, (err) => { outcome = err || null; });
  return outcome;
};
const company = (id) => db.find('companies', (c) => c.id === id);

const seedWith = (...employees) => fx.seed(employees, {
  companies: [
    { id: C1, name: 'Parent', is_active: true, parent_company_id: null },
    { id: C1_CHILD, name: 'Child', is_active: true, parent_company_id: C1 },
  ],
});

test('switching a company off: its people are refused at once, refresh fails, and their sessions are gone', async () => {
  const person = fx.makeEmployee({ company_id: C1 });
  seedWith(person);
  const session = await authService.loginToPortal('employee', person.email, PASSWORD, null);
  expect(await checkAccess(session.accessToken)).toBeNull();

  await superAdminService.setCompanyActive(C1, false);
  expect(company(C1).is_active).toBe(false);
  expect(await checkAccess(session.accessToken)).toMatchObject({ statusCode: 403 });
  await expect(authService.refreshAccessToken(session.refreshToken)).rejects.toMatchObject({ statusCode: expect.any(Number) });
  expect(fx.refreshRowsFor(person.id)).toHaveLength(0);
});

test('a subsidiary is switched off with its parent', async () => {
  const person = fx.makeEmployee({ company_id: C1_CHILD });
  seedWith(person);
  const session = await authService.loginToPortal('employee', person.email, PASSWORD, null);
  expect(await checkAccess(session.accessToken)).toBeNull();

  company(C1).is_active = false;
  expect(await checkAccess(session.accessToken)).toMatchObject({ statusCode: 403 });
  await expect(authService.refreshAccessToken(session.refreshToken)).rejects.toThrow(/switched off/);
});

test('switching it back on lets people sign in again', async () => {
  const person = fx.makeEmployee({ company_id: C1 });
  seedWith(person);
  await superAdminService.setCompanyActive(C1, false);
  await superAdminService.setCompanyActive(C1, true);
  const session = await authService.loginToPortal('employee', person.email, PASSWORD, null);
  expect(await checkAccess(session.accessToken)).toBeNull();
});
