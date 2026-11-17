/**
 * Audit #10: a subsidiary is billed through its top parent. Its employees use
 * the parent's seats (one pool for the group), it gets the parent's plan
 * features (plus the parent's overrides), and its own overrides can only
 * switch a feature off. The database is an in-memory stand-in; nothing is
 * sent and backend/.env is never read.
 */
jest.mock('dotenv', () => ({ config: () => ({ parsed: {} }) }));
jest.mock('../../src/config/supabase', () => require('./subsidiary-fakeDb'));
jest.mock('../../src/utils/logger', () => new Proxy({}, {
  get: (_t, prop) => (prop === '__esModule' || prop === 'then' ? undefined : () => {}),
}));
const quiet = () => new Proxy({}, {
  get: (_t, prop) => (prop === '__esModule' || prop === 'then' ? undefined : () => Promise.resolve()),
});
jest.mock('../../src/services/email.service', () => quiet());
jest.mock('../../src/services/subscriptionNotification.service', () => quiet());

const { reset, db } = require('./subsidiary-fakeDb');
const subscriptionService = require('../../src/services/subscription.service');
const featureOverrideService = require('../../src/services/featureOverride.service');
const tenantBillingService = require('../../src/services/tenantBilling.service');
const { ConflictError, ForbiddenError, BadRequestError } = require('../../src/utils/errors');

const PLANS = [
  { id: 'plan-starter', name: 'Starter', code: 'starter', is_active: true, included_seats: 5, max_seats: 100, features: { helpdesk: true, assets: true, payroll: false, recruitment: false } },
  { id: 'plan-growth', name: 'Growth', code: 'growth', is_active: true, included_seats: 10, max_seats: 500, features: { helpdesk: true, assets: true, payroll: true, recruitment: true } },
];

const sub = (id, companyId, planId, status, seatCount, createdAt = '2026-01-01T00:00:00Z', extra = {}) => ({
  id, company_id: companyId, plan_id: planId, status, seat_count: seatCount, max_seats_override: null,
  billing_cycle: 'monthly', price_locked_at_signup: 1000, current_period_start: '2026-11-01T00:00:00Z',
  current_period_end: '2026-12-01T00:00:00Z', next_renewal_date: '2026-12-01T00:00:00Z', auto_renew: true,
  cancel_at_period_end: false, created_at: createdAt, ...extra,
});

const staff = (companyId, count, { active = true, from = 0 } = {}) => Array.from({ length: count }, (_, i) => ({
  id: `${companyId}-e${from + i + 1}`, company_id: companyId, is_active: active, role: 'employee',
}));

/** Parent Co (Starter, 25 seats) with one subsidiary, plus an unrelated company. */
const group = ({ parentStaff = 20, childStaff = 5 } = {}) => ({
  subscription_plans: PLANS,
  companies: [
    { id: 'p', name: 'Parent Co', parent_company_id: null, company_type: 'parent' },
    { id: 'c', name: 'Child Co', parent_company_id: 'p', company_type: 'child' },
    { id: 'x', name: 'Other Co', parent_company_id: null, company_type: 'standalone' },
  ],
  company_billing_subscriptions: [
    sub('sub-p', 'p', 'plan-starter', 'active', 25),
    sub('sub-x', 'x', 'plan-growth', 'active', 50),
  ],
  company_feature_overrides: [],
  employees: [
    ...staff('p', parentStaff),
    ...staff('p', 3, { active: false, from: 100 }), // inactive: never counted
    ...staff('c', childStaff),
    ...staff('x', 10),
  ],
});

beforeEach(() => {
  subscriptionService.clearBillingCache();
  reset(group());
});

describe('seats: one pool for the whole group', () => {
  test("a subsidiary's employees count against the parent's seats", async () => {
    const parent = await subscriptionService.getSeatUsage('p');
    expect(parent).toMatchObject({
      used: 25, limit: 25, planName: 'Starter', usedInSubsidiaries: 5, subsidiaryCount: 1, ownUsed: 20, billedThrough: null,
    });

    const child = await subscriptionService.getSeatUsage('c');
    expect(child).toMatchObject({
      used: 25, limit: 25, planName: 'Starter', ownUsed: 5, billedThrough: { id: 'p', name: 'Parent Co' },
    });
  });

  test('the 26th seat is refused in either company when the cap is 25', async () => {
    reset(group({ parentStaff: 19, childStaff: 5 })); // 24 of 25
    await expect(subscriptionService.assertSeatAvailable('c')).resolves.toBeUndefined();
    db.tables.employees.push({ id: 'c-new', company_id: 'c', is_active: true, role: 'employee' }); // 25 of 25

    const inChild = subscriptionService.assertSeatAvailable('c');
    await expect(inChild).rejects.toBeInstanceOf(ConflictError);
    await expect(subscriptionService.assertSeatAvailable('c')).rejects.toThrow(
      "Seat limit reached (25/25 on Parent Co's Starter plan, which this company shares). Increase seats on Parent Co's plan to add more employees.",
    );
    await expect(subscriptionService.assertSeatAvailable('p')).rejects.toThrow(
      'Seat limit reached (25/25 on the Starter plan, including 6 in subsidiaries). Increase seats to add more employees.',
    );
  });

  test("the parent's goodwill seat override covers the group", async () => {
    db.tables.company_billing_subscriptions[0].max_seats_override = 30;
    await expect(subscriptionService.assertSeatAvailable('c')).resolves.toBeUndefined();
    expect((await subscriptionService.getSeatUsage('c')).limit).toBe(30);
  });

  test('moving an employee inside the group needs no seat; moving one in from outside does', async () => {
    // Group is full (25/25).
    await expect(subscriptionService.assertSeatAvailable('c', { fromCompanyId: 'p' })).resolves.toBeUndefined();
    await expect(subscriptionService.assertSeatAvailable('p', { fromCompanyId: 'c' })).resolves.toBeUndefined();
    await expect(subscriptionService.assertSeatAvailable('c', { fromCompanyId: 'x' })).rejects.toBeInstanceOf(ConflictError);
  });

  test("a suspended or lapsed parent blocks adding employees anywhere in the group", async () => {
    reset(group({ parentStaff: 2, childStaff: 1 }));
    db.tables.company_billing_subscriptions[0].status = 'suspended';
    await expect(subscriptionService.assertSeatAvailable('c')).rejects.toThrow(
      "Parent Co's subscription is suspended, so no employees can be added. Contact billing to resolve this.",
    );
    db.tables.company_billing_subscriptions[0].status = 'expired';
    await expect(subscriptionService.assertSeatAvailable('p')).rejects.toThrow(
      "Your company's subscription is expired, so no employees can be added. Contact billing to resolve this.",
    );
  });

  test('a company never billed at all keeps the old behaviour (not blocked), and so do its subsidiaries', async () => {
    reset({
      subscription_plans: PLANS,
      companies: [
        { id: '00000000-0000-0000-0000-000000000001', name: 'Default', parent_company_id: null },
        { id: 'd-child', name: 'Default Child', parent_company_id: '00000000-0000-0000-0000-000000000001' },
      ],
      company_billing_subscriptions: [],
      company_feature_overrides: [],
      employees: staff('00000000-0000-0000-0000-000000000001', 500),
    });
    await expect(subscriptionService.assertSeatAvailable('00000000-0000-0000-0000-000000000001')).resolves.toBeUndefined();
    await expect(subscriptionService.assertSeatAvailable('d-child')).resolves.toBeUndefined();
  });

  test("a subsidiary's own old subscription no longer adds seats while the parent is billed", async () => {
    db.tables.company_billing_subscriptions.push(sub('sub-c', 'c', 'plan-growth', 'active', 100, '2026-06-01T00:00:00Z'));
    const usage = await subscriptionService.getSeatUsage('c');
    expect(usage).toMatchObject({ used: 25, limit: 25, planName: 'Starter', billedThrough: { id: 'p' } });
    await expect(subscriptionService.assertSeatAvailable('c')).rejects.toBeInstanceOf(ConflictError);
  });

  test('a super admin cannot give a subsidiary its own subscription', async () => {
    db.tables.company_billing_subscriptions = db.tables.company_billing_subscriptions.filter((s) => s.company_id !== 'p');
    await expect(subscriptionService.createSubscription('c', 'plan-growth', 'monthly', 10, 'sa-1'))
      .rejects.toThrow('Child Co is a subsidiary of Parent Co and uses its plan and seats. Manage billing on Parent Co instead.');
    await expect(subscriptionService.createSubscription('c', 'plan-growth', 'monthly', 10, 'sa-1'))
      .rejects.toBeInstanceOf(BadRequestError);
  });
});

describe("features: a subsidiary gets exactly the parent's", () => {
  test("without a subscription of its own, a subsidiary gets only the parent's plan features", async () => {
    expect(await featureOverrideService.hasFeature('c', 'payroll')).toBe(false); // Starter: no payroll
    expect(await featureOverrideService.hasFeature('c', 'recruitment')).toBe(false);
    expect(await featureOverrideService.hasFeature('c', 'helpdesk')).toBe(true);

    const { features, billedThrough } = await featureOverrideService.getEffectiveFeatures('c');
    expect(billedThrough).toEqual({ id: 'p', name: 'Parent Co' });
    const byKey = Object.fromEntries(features.map((f) => [f.key, f]));
    expect(byKey.payroll).toMatchObject({ planDefault: false, effective: false, isOverridden: false });
    expect(byKey.helpdesk).toMatchObject({ planDefault: true, effective: true });
  });

  test("the parent's overrides carry over to the subsidiary", async () => {
    db.tables.company_feature_overrides.push({ company_id: 'p', feature_key: 'payroll', enabled: true });
    db.tables.company_feature_overrides.push({ company_id: 'p', feature_key: 'helpdesk', enabled: false });
    expect(await featureOverrideService.hasFeature('c', 'payroll')).toBe(true);
    expect(await featureOverrideService.hasFeature('c', 'helpdesk')).toBe(false);
  });

  test("a subsidiary's own override cannot grant a feature the parent doesn't pay for", async () => {
    // An old switched-on row set directly on the subsidiary: it now does nothing.
    db.tables.company_feature_overrides.push({ company_id: 'c', feature_key: 'payroll', enabled: true, reason: 'old grant' });
    expect(await featureOverrideService.hasFeature('c', 'payroll')).toBe(false);
    const { features } = await featureOverrideService.getEffectiveFeatures('c');
    expect(features.find((f) => f.key === 'payroll')).toMatchObject({ effective: false, isOverridden: false });

    // And a new one is refused, with the reason.
    await expect(featureOverrideService.setFeatureOverride('c', 'recruitment', true, 'please', 'sa-1'))
      .rejects.toBeInstanceOf(ForbiddenError);
    await expect(featureOverrideService.setFeatureOverride('c', 'recruitment', true, 'please', 'sa-1'))
      .rejects.toThrow("Child Co is a subsidiary of Parent Co and gets Parent Co's features. Parent Co's plan doesn't include this feature — turn it on for Parent Co instead.");
  });

  test('a subsidiary override can switch a parent feature off, and back on again', async () => {
    await featureOverrideService.setFeatureOverride('c', 'helpdesk', false, 'not used here', 'sa-1');
    expect(await featureOverrideService.hasFeature('c', 'helpdesk')).toBe(false);
    expect(await featureOverrideService.hasFeature('p', 'helpdesk')).toBe(true);

    await featureOverrideService.setFeatureOverride('c', 'helpdesk', true, 'back on', 'sa-1');
    expect(await featureOverrideService.hasFeature('c', 'helpdesk')).toBe(true);
  });

  test("a subsidiary's own old subscription is ignored for features while the parent is billed", async () => {
    db.tables.company_billing_subscriptions.push(sub('sub-c', 'c', 'plan-growth', 'active', 100, '2026-06-01T00:00:00Z'));
    expect(await featureOverrideService.hasFeature('c', 'payroll')).toBe(false);
  });

  test("when no company above was ever billed, a subsidiary's own old subscription still applies", async () => {
    db.tables.company_billing_subscriptions = [sub('sub-c', 'c', 'plan-growth', 'active', 100)];
    expect(await featureOverrideService.hasFeature('c', 'payroll')).toBe(true);
    const usage = await subscriptionService.getSeatUsage('c');
    expect(usage).toMatchObject({ used: 5, limit: 100, billedThrough: null });
  });

  test('standalone companies are unchanged: own plan, own overrides both ways', async () => {
    expect(await featureOverrideService.hasFeature('x', 'payroll')).toBe(true);
    db.tables.company_feature_overrides.push({ company_id: 'x', feature_key: 'payroll', enabled: false });
    expect(await featureOverrideService.hasFeature('x', 'payroll')).toBe(false);
    db.tables.company_feature_overrides.push({ company_id: 'p', feature_key: 'recruitment', enabled: true });
    expect(await featureOverrideService.hasFeature('p', 'recruitment')).toBe(true);
  });

  test('never billed at all: every feature on unless switched off, as before', async () => {
    db.tables.company_billing_subscriptions = [];
    expect(await featureOverrideService.hasFeature('p', 'payroll')).toBe(true);
    expect(await featureOverrideService.hasFeature('c', 'payroll')).toBe(true);
    db.tables.company_feature_overrides.push({ company_id: 'c', feature_key: 'payroll', enabled: false });
    expect(await featureOverrideService.hasFeature('c', 'payroll')).toBe(false);
  });

  test("a lapsed parent's group reads its last plan, not every feature", async () => {
    db.tables.company_billing_subscriptions[0].status = 'expired';
    expect(await featureOverrideService.hasFeature('c', 'payroll')).toBe(false);
    expect(await featureOverrideService.hasFeature('c', 'helpdesk')).toBe(true);
  });

  test("a seat override can't be set on a subsidiary", async () => {
    await expect(featureOverrideService.setSeatOverride('c', 10))
      .rejects.toThrow("Child Co uses Parent Co's seats. Set the seat override on Parent Co instead.");
  });
});

describe('suspension and bad links', () => {
  test('parent suspended → subsidiary suspended', async () => {
    expect(await subscriptionService.isBillingSuspended('c')).toBe(false);
    db.tables.company_billing_subscriptions[0].status = 'suspended';
    expect(await subscriptionService.isBillingSuspended('c')).toBe(true);
    expect(await subscriptionService.isBillingSuspended('p')).toBe(true);
    expect(await subscriptionService.isBillingSuspended('x')).toBe(false);
  });

  test('a loop in the parent links is refused, not guessed at', async () => {
    db.tables.companies.push(
      { id: 'loop-a', name: 'Loop A', parent_company_id: 'loop-b' },
      { id: 'loop-b', name: 'Loop B', parent_company_id: 'loop-a' },
      { id: 'self', name: 'Self', parent_company_id: 'self' },
    );
    await expect(subscriptionService.getBillingRoot('loop-a')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(subscriptionService.getBillingRoot('self')).rejects.toThrow('loops back on itself');
    await expect(featureOverrideService.hasFeature('loop-a', 'helpdesk')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(subscriptionService.assertSeatAvailable('loop-b')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(subscriptionService.isBillingSuspended('loop-a')).rejects.toBeInstanceOf(ForbiddenError);
  });

  test('more than 5 parents is refused; 5 is fine', async () => {
    // d0 (top) ← d1 ← … ← d6
    for (let i = 0; i <= 6; i += 1) {
      db.tables.companies.push({ id: `d${i}`, name: `D${i}`, parent_company_id: i === 0 ? null : `d${i - 1}` });
    }
    expect(await subscriptionService.getBillingRoot('d5')).toBe('d0');
    await expect(subscriptionService.getBillingRoot('d6')).rejects.toThrow('more than 5 levels');
  });

  test('a company with no parent is its own root', async () => {
    expect(await subscriptionService.getBillingRoot('p')).toBe('p');
    expect(await subscriptionService.getBillingRoot('c')).toBe('p');
  });
});

describe('tenant billing screen for a subsidiary', () => {
  test("shows the parent's plan and the group's seats, without the parent's price", async () => {
    const view = await tenantBillingService.getMySubscription('c');
    expect(view).toMatchObject({
      billedThrough: { id: 'p', name: 'Parent Co' },
      planName: 'Starter',
      status: 'active',
      price: null,
      seatUsage: { used: 25, limit: 25, ownUsed: 5 },
    });
  });

  test('plan, seat and cancel requests are sent to the parent instead', async () => {
    const msg = "This company is billed through Parent Co. Its plan, seats and invoices are managed by Parent Co's admin.";
    await expect(tenantBillingService.requestSeatChange('c', 40, 'hr-1')).rejects.toThrow(msg);
    await expect(tenantBillingService.cancelMySubscription('c', { confirmCompanyName: 'Child Co' }, 'hr-1')).rejects.toThrow(msg);
  });

  test("the parent's own screen shows the group total", async () => {
    const view = await tenantBillingService.getMySubscription('p');
    expect(view.billedThrough).toBeUndefined();
    expect(view.seatUsage).toMatchObject({ used: 25, usedInSubsidiaries: 5, billedThrough: null });
  });
});
