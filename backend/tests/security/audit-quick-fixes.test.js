/**
 * Smaller fixes from the 20 Nov 2026 pre-launch audit:
 *  - 44.1: the leave calendar shows every colleague's leave reason (often
 *    medical) to anyone; now only HR and Admins see reasons.
 *  - #25: any HR could cancel the company's subscription at once through the
 *    API; now only an Admin, and always at the end of the paid period.
 *  - Feature requests put a tenant's raw text, as HTML, into an email to the
 *    super admins; now only known features, and the text is escaped.
 *  - The Payroll summary report showed everyone's pay to HR with Payroll
 *    unticked; it now needs Payroll → Manage too.
 * In-memory database; nothing is sent.
 */
jest.mock('dotenv', () => ({ config: () => ({ parsed: {} }) }));
jest.mock('../../src/config/supabase', () => ({ supabaseAdmin: { from: (...a) => mockDb.current.from(...a) } }));
jest.mock('../../src/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('../../src/services/leave.service', () => ({
  getLeaveCalendar: async () => [{ id: 'l1', employee_id: 'e2', from_date: '2026-11-24', to_date: '2026-11-24', reason: 'Hospital visit', rejection_reason: null }],
}));
jest.mock('../../src/services/email.service', () => ({ sendEmail: jest.fn(async () => ({ success: true })) }));
jest.mock('../../src/services/emailRecipients.service', () => ({ getPlatformAlertTo: async () => 'ops@spaxsync.test' }));
jest.mock('../../src/services/subscription.service', () => ({
  getBillingAccount: async (id) => ({ billingCompanyId: id, billedThroughParent: false }),
  cancelSubscription: jest.fn(async (id, actor, reason, immediate) => ({ id, immediate })),
}));

const mockDb = { current: null };
const { makeFakeSupabase } = require('./helpers/fakeSupabase');
const leaveController = require('../../src/controllers/leave.controller');
const tenantBilling = require('../../src/services/tenantBilling.service');
const subscriptionService = require('../../src/services/subscription.service');
const { sendEmail } = require('../../src/services/email.service');
const { BadRequestError } = require('../../src/utils/errors');

beforeEach(() => {
  mockDb.current = makeFakeSupabase({
    companies: [{ id: 'c1', name: 'Acme Ltd' }],
    company_billing_subscriptions: [{ id: 'sub1', company_id: 'c1', status: 'active' }],
    feature_requests: [],
  });
  jest.clearAllMocks();
});

const runCalendar = async (role) => {
  let payload = null;
  const res = { status() { return res; }, json(p) { payload = p; return res; } };
  await leaveController.calendar({ user: { id: 'u1', role, company_id: 'c1' }, query: {} }, res, (err) => { throw err; });
  return payload.data;
};

test('leave calendar: employees and managers see who is away, not why; HR and Admins see the reason', async () => {
  for (const role of ['employee', 'manager']) {
    // eslint-disable-next-line no-await-in-loop
    const [entry] = await runCalendar(role);
    expect(entry).toMatchObject({ employee_id: 'e2', from_date: '2026-11-24' });
    expect(entry).not.toHaveProperty('reason');
  }
  for (const role of ['hr', 'admin']) {
    // eslint-disable-next-line no-await-in-loop
    const [entry] = await runCalendar(role);
    expect(entry.reason).toBe('Hospital visit');
  }
});

test('cancelling the subscription: only an Admin, and never "immediately" from here', async () => {
  const router = require('../../src/routes/tenantBilling.routes');
  const { isAdmin } = require('../../src/middleware/role.middleware');
  const route = router.stack.find((l) => l.route?.path === '/cancel-subscription')?.route;
  expect(route.stack[0].handle).toBe(isAdmin);

  await tenantBilling.cancelMySubscription('c1', { reason: 'test', confirmCompanyName: 'Acme Ltd', immediate: true }, 'admin1');
  expect(subscriptionService.cancelSubscription).toHaveBeenCalledWith('sub1', 'admin1', 'test', false);
});

test('feature requests: unknown features are refused, and the email escapes what the company sent', async () => {
  await expect(tenantBilling.requestFeature('c1', '<a href="https://evil.test">Re-verify your account</a>', 'hr1'))
    .rejects.toBeInstanceOf(BadRequestError);
  expect(sendEmail).not.toHaveBeenCalled();

  await tenantBilling.requestFeature('c1', 'payroll', 'hr1');
  expect(sendEmail).toHaveBeenCalledTimes(1);
  expect(sendEmail.mock.calls[0][0].html).not.toMatch(/<a /);
});

test('the Payroll summary report also needs Payroll → Manage', () => {
  const router = require('../../src/routes/reports.routes');
  const route = router.stack.find((l) => l.route?.path === '/payroll-summary')?.route;
  // isManagerOrAbove, Reports → View, Payroll → Manage, the payroll feature, then the handler.
  expect(route.stack).toHaveLength(5);
  const attendance = router.stack.find((l) => l.route?.path === '/attendance-summary')?.route;
  expect(route.stack.length).toBe(attendance.stack.length + 2);
});
