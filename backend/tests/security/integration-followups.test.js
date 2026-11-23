// Integration follow-ups: API keys refused off the machine endpoints (#17),
// and a subsidiary signs in on its paying parent's subscription (#10).
jest.mock('dotenv', () => ({ config: () => ({ parsed: {} }) }));
jest.useFakeTimers();

const mockState = { statusByCompany: {}, lastEq: null };
jest.mock('../../src/config/supabase', () => {
  const builder = () => {
    const b = {};
    for (const m of ['select', 'in', 'order', 'limit']) b[m] = () => b;
    b.eq = (col, val) => { if (col === 'company_id') mockState.lastEq = val; return b; };
    b.maybeSingle = async () => {
      const status = mockState.statusByCompany[mockState.lastEq];
      return { data: status ? { status } : null, error: null };
    };
    return b;
  };
  return { supabaseAdmin: { from: () => builder() } };
});
jest.mock('../../src/services/apiKey.service', () => ({
  verifyApiKey: jest.fn(async () => ({ id: 'k1', company_id: 'c-1', scopes: ['attendance:write'] })),
  hasScope: (user, scope) => (user.scopes || []).includes(scope),
}));
jest.mock('../../src/services/subscription.service', () => ({
  isBillingSuspended: jest.fn(async () => false),
  isCompanySwitchedOff: jest.fn(async () => false),
  getBillingAccount: jest.fn(async (id) => ({ billingCompanyId: id === 'child-1' ? 'parent-1' : id })),
}));

const subscriptionService = require('../../src/services/subscription.service');
const { authenticate } = require('../../src/middleware/auth.middleware');

const run = (req) => new Promise((resolve) => {
  authenticate(req, {}, (err) => resolve({ err, req }));
});
const keyReq = (method, originalUrl) => ({
  method, originalUrl, headers: { 'x-api-key': 'hrms_live_abc' }, cookies: {},
});

describe('API keys (#17)', () => {
  test('accepted on the biometric webhook', async () => {
    const { err, req } = await run(keyReq('POST', '/api/attendance/biometric-webhook'));
    expect(err).toBeUndefined();
    expect(req.user.is_api_key).toBe(true);
  });

  test('refused on a logged-in route with no role check', async () => {
    const { err } = await run(keyReq('GET', '/api/attendance/report/2b0c7c1e-1111-4222-8333-944455556666'));
    expect(err?.message).toMatch(/only be used on the integration endpoints/);
  });

  test('refused while the company (or its parent) is suspended', async () => {
    subscriptionService.isBillingSuspended.mockResolvedValueOnce(true);
    const { err } = await run(keyReq('GET', '/api/integration/ping'));
    expect(err?.message).toMatch(/suspended/);
  });
});

describe('subsidiary sign-in follows the parent (#10)', () => {
  // assertCompanyInGoodStanding is internal; reach it through the module.
  const authService = require('../../src/services/auth.service');
  const check = authService.assertCompanyInGoodStanding;

  beforeEach(() => { mockState.statusByCompany = {}; });

  test('child with no subscription signs in on the parent\'s active one', async () => {
    mockState.statusByCompany = { 'parent-1': 'active' };
    await expect(check('child-1', 'employee')).resolves.toBeUndefined();
  });

  test('child is refused when the parent has expired', async () => {
    mockState.statusByCompany = { 'parent-1': 'expired' };
    await expect(check('child-1', 'hr')).rejects.toThrow(/expired/);
  });
});
