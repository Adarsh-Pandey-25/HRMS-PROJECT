/**
 * Owner's report, 24 Nov 2026:
 *  1. A subsidiary's employee codes restart at EMP001, like the primary
 *     company's. Opening an employee by code took the first match, so
 *     editing a subsidiary's EMP001 opened — and saved — the primary
 *     company's EMP001. A shared code is now refused, never guessed.
 *  2. A subsidiary's people couldn't sign in on the primary company's web
 *     address. They now can (and on their own company's address); a
 *     subsidiary's address stays only for its own people.
 * In-memory databases only.
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
const { authenticate } = require('../../src/middleware/auth.middleware');

const { PASSWORD, C1, C1_CHILD, C2 } = fx;

const checkAccess = async (accessToken, tenantId) => {
  let outcome;
  await authenticate({ cookies: { accessToken }, headers: {}, tenantCompany: tenantId ? { id: tenantId } : null }, {}, (err) => { outcome = err || null; });
  return outcome;
};
const seedWith = (...employees) => fx.seed(employees, {
  companies: [
    { id: C1, name: 'Primary', is_active: true, parent_company_id: null },
    { id: C1_CHILD, name: 'Subsidiary', is_active: true, parent_company_id: C1 },
    { id: C2, name: 'Other', is_active: true, parent_company_id: null },
  ],
});

describe('signing in on a company\'s web address', () => {
  test('a subsidiary\'s employee signs in on the primary company\'s address, and the session works there', async () => {
    const person = fx.makeEmployee({ company_id: C1_CHILD });
    seedWith(person);
    const session = await authService.loginToPortal('employee', person.email, PASSWORD, C1);
    expect(session.accessToken).toBeTruthy();
    expect(await checkAccess(session.accessToken, C1)).toBeNull();
    const refreshed = await authService.refreshAccessToken(session.refreshToken, C1);
    expect(refreshed.accessToken).toBeTruthy();
    // And on their own company's address, as before.
    await expect(authService.loginToPortal('employee', person.email, PASSWORD, C1_CHILD)).resolves.toBeTruthy();
  });

  test('a subsidiary\'s address is only for its own people; another company\'s address for nobody here', async () => {
    const primary = fx.makeEmployee({ company_id: C1 });
    const sub = fx.makeEmployee({ company_id: C1_CHILD });
    seedWith(primary, sub);
    await expect(authService.loginToPortal('employee', primary.email, PASSWORD, C1_CHILD)).rejects.toMatchObject({ statusCode: 401 });
    await expect(authService.loginToPortal('employee', sub.email, PASSWORD, C2)).rejects.toMatchObject({ statusCode: 401 });
    const session = await authService.loginToPortal('employee', primary.email, PASSWORD, C1);
    expect(await checkAccess(session.accessToken, C1_CHILD)).toMatchObject({ statusCode: 401 });
  });

  test('the same email at the primary company and a subsidiary: each address signs in its own company\'s account', async () => {
    const email = 'shared@acme.test';
    const atPrimary = fx.makeEmployee({ company_id: C1, email });
    const atSub = fx.makeEmployee({ company_id: C1_CHILD, email });
    seedWith(atPrimary, atSub);
    const onPrimary = await authService.loginToPortal('employee', email, PASSWORD, C1);
    const onSub = await authService.loginToPortal('employee', email, PASSWORD, C1_CHILD);
    expect(onPrimary.employee?.id || onPrimary.user?.id).toBe(atPrimary.id);
    expect(onSub.employee?.id || onSub.user?.id).toBe(atSub.id);
  });
});
