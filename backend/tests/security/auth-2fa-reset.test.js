/**
 * Admin/HR reset of someone's two-step login (lost phone): who may reset
 * whom, what the reset does, and that it stays inside the company.
 * In-memory database only.
 */
jest.mock('dotenv', () => ({ config: () => ({ parsed: {} }) }));
jest.mock('../../src/config/supabase', () => ({ supabaseAdmin: require('./auth-fixtures').db.client }));
jest.mock('../../src/utils/logger', () => new Proxy({}, {
  get: (_t, prop) => (prop === '__esModule' || prop === 'then' ? undefined : () => {}),
}));
jest.mock('../../src/services/email.service', () => ({
  sendEmail: jest.fn(() => Promise.resolve({ success: true })),
  welcomeEmail: jest.fn(() => Promise.resolve()),
  passwordResetEmail: jest.fn(() => Promise.resolve()),
  onboardingOtpEmail: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../src/services/auditLog.service', () => ({
  logAudit: jest.fn(() => Promise.resolve()), auditFromRequest: jest.fn(),
}));
jest.mock('../../src/services/tenant.service', () => ({
  getOrgCompanyIds: jest.fn(async (id) => require('./auth-fixtures').ORG[id] || [id]),
}));

const fx = require('./auth-fixtures');
const totp = require('../../src/utils/totp');
const authService = require('../../src/services/auth.service');
const authController = require('../../src/controllers/auth.controller');
const { sendEmail } = require('../../src/services/email.service');
const { logAudit } = require('../../src/services/auditLog.service');

const { db, C1, C1_CHILD, C2 } = fx;

const withTwoFa = (overrides) => fx.makeEmployee({
  two_fa_enabled: true, totp_secret: totp.encryptSecret(totp.generateSecret()), ...overrides,
});

/** One person of each role at C1, plus one at the child company and one at an unrelated company. */
const people = () => ({
  admin: withTwoFa({ role: 'admin', first_name: 'Asha', last_name: 'Admin' }),
  admin2: withTwoFa({ role: 'admin' }),
  hr: withTwoFa({ role: 'hr', first_name: 'Hari', last_name: 'HR' }),
  hr2: withTwoFa({ role: 'hr' }),
  manager: withTwoFa({ role: 'manager' }),
  employee: withTwoFa({ role: 'employee' }),
  childEmployee: withTwoFa({ role: 'employee', company_id: C1_CHILD }),
  otherCompany: withTwoFa({ role: 'employee', company_id: C2 }),
  otherAdmin: withTwoFa({ role: 'admin', company_id: C2 }),
});

let p;
beforeEach(() => {
  p = people();
  fx.seed(Object.values(p));
  sendEmail.mockClear();
  logAudit.mockClear();
});

const actor = (person) => ({
  id: person.id, role: person.role, company_id: person.company_id, first_name: person.first_name, last_name: person.last_name,
});

const outcome = async (by, target) => {
  try {
    await authService.resetEmployeeTwoFactor(actor(by), target.id);
    return 'reset';
  } catch (err) {
    return err.statusCode;
  }
};

describe('who may reset whom', () => {
  test.each([
    ['admin', 'employee', 'reset'],
    ['admin', 'manager', 'reset'],
    ['admin', 'hr', 'reset'],
    ['admin', 'admin2', 'reset'],
    ['admin', 'childEmployee', 'reset'],
    ['admin', 'admin', 403],
    ['admin', 'otherCompany', 404],
    ['hr', 'employee', 'reset'],
    ['hr', 'manager', 'reset'],
    ['hr', 'childEmployee', 'reset'],
    ['hr', 'admin', 403],
    ['hr', 'hr2', 403],
    ['hr', 'hr', 403],
    ['hr', 'otherCompany', 404],
    ['manager', 'employee', 403],
    ['employee', 'manager', 403],
    ['otherAdmin', 'employee', 404],
  ])('%s → %s: %s', async (by, target, expected) => {
    expect(await outcome(p[by], p[target])).toBe(expected);
    const row = fx.employeeRow(p[target].id);
    expect(row.two_fa_enabled).toBe(expected === 'reset' ? false : true);
  });

  test('ids are compared case-insensitively', async () => {
    // Upper-case target id still finds the person…
    await authService.resetEmployeeTwoFactor(actor(p.admin), p.employee.id.toUpperCase());
    expect(fx.employeeRow(p.employee.id).two_fa_enabled).toBe(false);
    // …and an upper-case self id is still "yourself".
    const self = { ...actor(p.hr), id: p.hr.id.toUpperCase() };
    await expect(authService.resetEmployeeTwoFactor(self, p.hr.id)).rejects.toMatchObject({ statusCode: 403 });
    expect(() => authService.assertCanResetTwoFactor({ id: p.admin.id.toUpperCase(), role: 'admin' }, p.admin)).toThrow(/your own/);
  });
});

describe('what a reset does', () => {
  test('clears the secret, turns two-step login off, signs out everywhere, logs and emails', async () => {
    db.tables.refresh_tokens.push({
      id: fx.newId(), employee_id: p.employee.id, token_hash: 'x', expires_at: new Date(Date.now() + 86400000).toISOString(),
    });

    const result = await authService.resetEmployeeTwoFactor(actor(p.admin), p.employee.id, { ipAddress: '10.0.0.1' });
    expect(result).toEqual({ employeeId: p.employee.id, twoFaEnabled: false });

    const row = fx.employeeRow(p.employee.id);
    expect(row.two_fa_enabled).toBe(false);
    expect(row.totp_secret).toBeNull();
    expect(row.token_version).toBe(1);
    expect(fx.refreshRowsFor(p.employee.id)).toHaveLength(0);

    // The audit entry and the email go out in the background.
    await new Promise((resolve) => setImmediate(resolve));
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      companyId: C1, actorId: p.admin.id, actionType: 'employee.two_step_reset', targetId: p.employee.id, ipAddress: '10.0.0.1',
    }));
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const mail = sendEmail.mock.calls[0][0];
    expect(mail.to).toBe(p.employee.email);
    expect(mail.subject).toBe('Your two-step login was reset');
    expect(mail.html).toContain('Your two-step login was reset by Asha Admin.');

    // Other people are untouched.
    expect(fx.employeeRow(p.manager.id).two_fa_enabled).toBe(true);
  });

  test('after a reset the person signs in with just their password', async () => {
    await authService.resetEmployeeTwoFactor(actor(p.hr), p.employee.id);
    const session = await authService.loginToPortal('employee', p.employee.email, fx.PASSWORD, null);
    expect(session.requires2FA).toBeUndefined();
    expect(session.accessToken).toBeTruthy();
  });

  test('a person without two-step login on is told so', async () => {
    const plain = fx.makeEmployee();
    db.tables.employees.push(plain);
    await expect(authService.resetEmployeeTwoFactor(actor(p.admin), plain.id))
      .rejects.toMatchObject({ statusCode: 400, message: "Two-step login isn't turned on for this person." });
  });

  test('the HTTP handler refuses during impersonation and passes the actor through otherwise', async () => {
    const blocked = await fx.runHandler(authController.resetEmployeeTwoFactor, {
      user: actor(p.admin), params: { employeeId: p.employee.id }, impersonation: { isImpersonating: true },
    });
    expect(blocked.error).toMatchObject({ statusCode: 403 });
    expect(fx.employeeRow(p.employee.id).two_fa_enabled).toBe(true);

    const ok = await fx.runHandler(authController.resetEmployeeTwoFactor, {
      user: actor(p.hr), params: { employeeId: p.manager.id },
    });
    expect(ok.error).toBeNull();
    expect(ok.res.body.data).toEqual({ employeeId: p.manager.id, twoFaEnabled: false });
    expect(fx.employeeRow(p.manager.id).two_fa_enabled).toBe(false);
  });
});
