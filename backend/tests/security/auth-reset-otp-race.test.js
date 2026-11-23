/**
 * Audit, 20 Nov 2026: the password-reset code (6 digits, 3 tries) could be
 * guessed by sending many tries at the same moment — the try was counted
 * only after the database calls, so they all passed the check; a new code
 * reset the count; parallel "forgot password" requests left several codes
 * live; and "a.dmin+1@gmail.com" got its own rate limit. Sign-in had the same
 * check-then-count gap. In-memory database only; nothing is sent.
 */
jest.mock('dotenv', () => ({ config: () => ({ parsed: {} }) }));
jest.mock('../../src/config/supabase', () => ({ supabaseAdmin: require('./auth-fixtures').db.client }));
jest.mock('../../src/utils/logger', () => new Proxy({}, {
  get: (_t, prop) => (prop === '__esModule' || prop === 'then' ? undefined : () => {}),
}));
jest.mock('../../src/services/email.service', () => ({
  sendEmail: jest.fn(() => Promise.resolve({ success: true })),
  welcomeEmail: jest.fn(() => Promise.resolve()),
  passwordResetEmail: jest.fn((employee, otp) => { mockCodes.push(otp); return Promise.resolve(); }),
  onboardingOtpEmail: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../src/services/auditLog.service', () => ({
  logAudit: jest.fn(() => Promise.resolve()), auditFromRequest: jest.fn(),
}));
jest.mock('../../src/services/tenant.service', () => ({
  getOrgCompanyIds: jest.fn(async (id) => require('./auth-fixtures').ORG[id] || [id]),
}));

const mockCodes = [];
const fx = require('./auth-fixtures');
const authService = require('../../src/services/auth.service');
const { mailboxKey } = require('../../src/middleware/rateLimiter.middleware');

const NEW_PASSWORD = 'New-Passw0rd!';
let clock;
const advance = (ms) => { clock += ms; };

beforeEach(() => {
  mockCodes.length = 0;
  clock = Date.now() + Math.floor(Math.random() * 1e9); // a fresh guard per test (keys include the email)
  jest.spyOn(Date, 'now').mockImplementation(() => clock);
});
afterEach(() => jest.restoreAllMocks());

const person = () => {
  const employee = fx.makeEmployee();
  fx.seed([employee], { password_reset_tokens: [] });
  return employee;
};
const liveCodes = (employee) => fx.db.rows('password_reset_tokens').filter((t) => t.employee_id === employee.id && !t.used);
// The real table defaults `used` to false; the in-memory one has no defaults.
const withDefaults = () => fx.db.rows('password_reset_tokens').forEach((t) => { if (t.used === undefined) t.used = false; });
const requestCode = async (email) => {
  const result = await authService.forgotPassword(email);
  withDefaults();
  return result;
};
const wrongCode = (code) => String((Number(code) + 1) % 900000 + 100000);
const settled = (promises) => Promise.allSettled(promises).then((all) => all.map((r) => (r.status === 'fulfilled' ? 'ok' : r.reason?.constructor?.name)));

describe('password-reset code', () => {
  test('twenty wrong codes sent at once: all are refused as locked, and the live code is burned', async () => {
    const employee = person();
    await requestCode(employee.email);
    const [code] = mockCodes;
    expect(liveCodes(employee)).toHaveLength(1);

    const outcomes = await settled(Array.from({ length: 20 }, (_, i) => authService.resetPassword(employee.email, wrongCode(Number(code) + i), NEW_PASSWORD)));
    expect(outcomes.filter((o) => o === 'BadRequestError')).toHaveLength(0);
    expect(outcomes.filter((o) => o === 'TooManyRequestsError')).toHaveLength(20);
    expect(liveCodes(employee)).toHaveLength(0);

    // After the wait, the burned code no longer works.
    advance(61 * 1000);
    await expect(authService.resetPassword(employee.email, code, NEW_PASSWORD)).rejects.toThrow(/Invalid or expired/);
    expect(fx.employeeRow(employee.id).password_hash).toBe(employee.password_hash);
  });

  test('a new code does not give fresh tries', async () => {
    const employee = person();
    await requestCode(employee.email);
    await expect(authService.resetPassword(employee.email, wrongCode(mockCodes[0]), NEW_PASSWORD)).rejects.toThrow(/2 attempt/);
    await expect(authService.resetPassword(employee.email, wrongCode(mockCodes[0]), NEW_PASSWORD)).rejects.toThrow(/1 attempt/);
    advance(61 * 1000);
    await requestCode(employee.email);
    // The count carried over: this wrong try is the third, and locks.
    await expect(authService.resetPassword(employee.email, wrongCode(mockCodes[1]), NEW_PASSWORD)).rejects.toThrow(/Too many wrong OTPs/);
    expect(liveCodes(employee)).toHaveLength(0);
  });

  test('parallel "forgot password" requests send one code', async () => {
    const employee = person();
    const outcomes = await settled(Array.from({ length: 5 }, () => authService.forgotPassword(employee.email)));
    withDefaults();
    expect(outcomes.filter((o) => o === 'ok')).toHaveLength(1);
    expect(mockCodes).toHaveLength(1);
    expect(liveCodes(employee)).toHaveLength(1);
  });

  test('the right code still works, and a weak new password is not counted as a wrong try', async () => {
    const employee = person();
    await requestCode(employee.email);
    const [code] = mockCodes;
    for (let i = 0; i < 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await expect(authService.resetPassword(employee.email, code, 'weak')).rejects.toThrow();
    }
    await authService.resetPassword(employee.email, code, NEW_PASSWORD);
    expect(fx.employeeRow(employee.id).password_hash).not.toBe(employee.password_hash);
    expect(liveCodes(employee)).toHaveLength(0);
  });
});

describe('sign-in', () => {
  test('at most 3 sign-ins are checked at once for one email; the rest are told to wait', async () => {
    const employee = person();
    const outcomes = await settled(Array.from({ length: 8 }, () => authService.login(employee.email, 'Wrong-Passw0rd!')));
    const atOnce = outcomes.filter((o) => o === 'TooManyRequestsError');
    expect(atOnce.length).toBeGreaterThanOrEqual(5);
    expect(outcomes.filter((o) => o !== 'TooManyRequestsError').length).toBeLessThanOrEqual(3);
    // One at a time still works.
    await expect(authService.login(employee.email, fx.PASSWORD)).resolves.toBeTruthy();
  });
});

describe('rate-limit key for an email', () => {
  test('dots and +tags reach the same Gmail mailbox, so they share one limit', () => {
    expect(mailboxKey('a.dmin+7@gmail.com')).toBe('admin@gmail.com');
    expect(mailboxKey(' Ad.Min@GoogleMail.com ')).toBe('admin@googlemail.com');
    expect(mailboxKey('priya+hr@acme.in')).toBe('priya@acme.in');
    expect(mailboxKey('priya.sharma@acme.in')).toBe('priya.sharma@acme.in');
    expect(mailboxKey(undefined)).toBe('none');
  });
});
