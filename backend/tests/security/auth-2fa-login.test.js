/**
 * Audit #28: employee two-step login. The pending token from the password
 * step is short-lived, purpose-checked, single-use and allows 5 codes; the
 * password step returns nothing about the account. In-memory database only.
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

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const fx = require('./auth-fixtures');
const totp = require('../../src/utils/totp');
const authService = require('../../src/services/auth.service');
const authController = require('../../src/controllers/auth.controller');
const { authenticate } = require('../../src/middleware/auth.middleware');

const { db, PASSWORD } = fx;
const SECRET = totp.generateSecret();
const STEP_MS = 30 * 1000;

const twoFaEmployee = (overrides = {}) => fx.makeEmployee({
  two_fa_enabled: true, totp_secret: totp.encryptSecret(SECRET), ...overrides,
});

/** Password step through the employee portal; returns the pending token. */
const passwordStep = async (emp) => {
  const result = await authService.loginToPortal('employee', emp.email, PASSWORD, null);
  expect(result.requires2FA).toBe(true);
  return result.twoFaToken;
};

const codeAt = (offsetMs = 0) => totp.generateTotp(SECRET, Date.now() + offsetMs);

/** A code that is certainly wrong right now (none of the three accepted steps). */
const wrongCode = () => {
  const valid = new Set([-STEP_MS, 0, STEP_MS].map(codeAt));
  for (let n = 0; ; n += 1) {
    const candidate = String(n).padStart(6, '0');
    if (!valid.has(candidate)) return candidate;
  }
};

const challengeFor = (token) => db.find('two_fa_login_challenges', (c) => c.jti === jwt.decode(token).jti);

const failureOf = async (promise) => {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error('expected the call to fail');
};

afterEach(() => jest.restoreAllMocks());

describe('password step', () => {
  test('returns only requires2FA and the pending token — no employee data, no session', async () => {
    const emp = twoFaEmployee();
    fx.seed([emp]);

    const result = await authService.loginToPortal('employee', emp.email, PASSWORD, null);
    expect(Object.keys(result).sort()).toEqual(['requires2FA', 'twoFaToken']);
    expect(fx.refreshRowsFor(emp.id)).toHaveLength(0);

    // And through the HTTP handler: nothing but the two fields, no cookies.
    const { res, error } = await fx.runHandler(authController.loginEmployee, { body: { email: emp.email, password: PASSWORD } });
    expect(error).toBeNull();
    expect(Object.keys(res.body.data).sort()).toEqual(['requires2FA', 'twoFaToken']);
    expect(res.cookies).toEqual({});
  });

  test('the portal role is checked before two-step login starts', async () => {
    const admin = twoFaEmployee({ role: 'admin' });
    fx.seed([admin]);
    const err = await failureOf(authService.loginToPortal('employee', admin.email, PASSWORD, null));
    expect(err.message).toBe('Invalid email or password');
    expect(db.rows('two_fa_login_challenges')).toHaveLength(0);
  });
});

describe('code step', () => {
  test('a correct code signs in through the HTTP handler (the #28 ReferenceError is gone)', async () => {
    const emp = twoFaEmployee();
    fx.seed([emp]);
    const twoFaToken = await passwordStep(emp);

    const { res, error } = await fx.runHandler(authController.verifyTwoFaAndLogin, { body: { twoFaToken, code: codeAt() } });
    expect(error).toBeNull();
    expect(res.body.data.employee.id).toBe(emp.id);
    expect(res.body.data.employee.totp_secret).toBeUndefined();
    expect(res.cookies.accessToken).toBeTruthy();
    expect(res.cookies.refreshToken).toBeTruthy();
    expect(fx.refreshRowsFor(emp.id)).toHaveLength(1);
  });

  test('the pending token is single-use', async () => {
    const emp = twoFaEmployee();
    fx.seed([emp]);
    const twoFaToken = await passwordStep(emp);

    await authService.verifyTwoFaLogin(twoFaToken, codeAt());
    // A different, still-valid code: it's the token that is spent.
    const err = await failureOf(authService.verifyTwoFaLogin(twoFaToken, codeAt(STEP_MS)));
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe('This sign-in has already been used. Please sign in again.');
    expect(err.details).toMatchObject({ restartLogin: true });
    expect(fx.refreshRowsFor(emp.id)).toHaveLength(1);
  });

  test('the same code can not sign in twice, even with a new pending token (replay)', async () => {
    const emp = twoFaEmployee();
    fx.seed([emp]);
    const code = codeAt();

    await authService.verifyTwoFaLogin(await passwordStep(emp), code);
    const err = await failureOf(authService.verifyTwoFaLogin(await passwordStep(emp), code));
    expect(err.statusCode).toBe(400);
    expect(err.message).toMatch(/already been used/);
    expect(err.details).toEqual({ attemptsRemaining: 4 });
  });

  test('an access token is refused as a pending token, and a pending token as an access token', async () => {
    const emp = twoFaEmployee();
    fx.seed([emp]);
    const twoFaToken = await passwordStep(emp);

    const accessToken = jwt.sign({ id: emp.id, company_id: emp.company_id, token_version: 0 }, process.env.JWT_SECRET);
    const err = await failureOf(authService.verifyTwoFaLogin(accessToken, codeAt()));
    expect(err.details).toMatchObject({ restartLogin: true });

    // Right key, right challenge, wrong purpose: still refused.
    const key = crypto.createHmac('sha256', process.env.JWT_SECRET).update('spaxsync:employee-2fa-pending:v1').digest();
    const wrongPurpose = jwt.sign(
      { id: emp.id, company_id: emp.company_id, token_version: 0, purpose: 'access' },
      key,
      { algorithm: 'HS256', expiresIn: 300, jwtid: jwt.decode(twoFaToken).jti },
    );
    expect((await failureOf(authService.verifyTwoFaLogin(wrongPurpose, codeAt()))).details).toMatchObject({ restartLogin: true });

    // The pending token does not verify with the access-token key at all…
    expect(() => jwt.verify(twoFaToken, process.env.JWT_SECRET)).toThrow();
    // …so the auth middleware refuses it.
    let passed;
    await authenticate({ cookies: {}, headers: { authorization: `Bearer ${twoFaToken}` } }, {}, (e) => { passed = e; });
    expect(passed).toBeTruthy();
    expect(passed.statusCode).toBe(401);
  });

  test('the pending token expires after 5 minutes', async () => {
    const emp = twoFaEmployee();
    fx.seed([emp]);
    const twoFaToken = await passwordStep(emp);

    const later = Date.now() + 5 * 60 * 1000 + 1000;
    jest.spyOn(Date, 'now').mockReturnValue(later);
    const err = await failureOf(authService.verifyTwoFaLogin(twoFaToken, totp.generateTotp(SECRET, later)));
    expect(err.message).toBe('Your sign-in has expired. Please sign in again.');
    expect(err.details).toMatchObject({ restartLogin: true });
  });

  test('the database expiry is enforced too, not just the token\'s own', async () => {
    const emp = twoFaEmployee();
    fx.seed([emp]);
    const twoFaToken = await passwordStep(emp);
    challengeFor(twoFaToken).expires_at = new Date(Date.now() - 1000).toISOString();

    const err = await failureOf(authService.verifyTwoFaLogin(twoFaToken, codeAt()));
    expect(err.details).toMatchObject({ restartLogin: true });
  });

  test('5 wrong codes, then the person must sign in again', async () => {
    const emp = twoFaEmployee();
    fx.seed([emp]);
    const twoFaToken = await passwordStep(emp);

    for (let left = 4; left >= 1; left -= 1) {
      const err = await failureOf(authService.verifyTwoFaLogin(twoFaToken, wrongCode()));
      expect(err.statusCode).toBe(400);
      expect(err.details).toEqual({ attemptsRemaining: left });
    }
    const fifth = await failureOf(authService.verifyTwoFaLogin(twoFaToken, wrongCode()));
    expect(fifth.statusCode).toBe(429);
    expect(fifth.message).toBe('Too many wrong codes. Please sign in again.');
    expect(fifth.details).toMatchObject({ restartLogin: true });

    // Even the right code is refused now.
    const after = await failureOf(authService.verifyTwoFaLogin(twoFaToken, codeAt()));
    expect(after.statusCode).toBe(429);
    expect(after.details).toMatchObject({ restartLogin: true });
    expect(challengeFor(twoFaToken).attempts).toBe(5);
    expect(fx.refreshRowsFor(emp.id)).toHaveLength(0);
  });

  test('parallel guesses never get more than 5 tries', async () => {
    const emp = twoFaEmployee();
    fx.seed([emp]);
    const twoFaToken = await passwordStep(emp);

    const results = await Promise.allSettled(Array.from({ length: 12 }, () => authService.verifyTwoFaLogin(twoFaToken, wrongCode())));
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    expect(challengeFor(twoFaToken).attempts).toBe(5);
    expect(results.filter((r) => r.reason.statusCode === 400)).toHaveLength(4);
  });

  test('a sign-out-everywhere between the two steps cancels the pending sign-in', async () => {
    const emp = twoFaEmployee();
    fx.seed([emp]);
    const twoFaToken = await passwordStep(emp);
    await authService.bumpTokenVersion(emp.id);

    const err = await failureOf(authService.verifyTwoFaLogin(twoFaToken, codeAt()));
    expect(err.details).toMatchObject({ restartLogin: true });
  });

  test('a pending token from another company\'s login page is refused', async () => {
    const emp = twoFaEmployee();
    fx.seed([emp]);
    const twoFaToken = await passwordStep(emp);

    const err = await failureOf(authService.verifyTwoFaLogin(twoFaToken, codeAt(), fx.C2));
    expect(err.details).toMatchObject({ restartLogin: true });
  });
});
