/**
 * Audit #6: a stolen session must not survive a password change or reset.
 * Refresh checks token_version, token reuse can only raise it, and a
 * sign-out-everywhere deletes every refresh token. In-memory database only.
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
const authService = require('../../src/services/auth.service');
const authController = require('../../src/controllers/auth.controller');
const { authenticate } = require('../../src/middleware/auth.middleware');

const { db, PASSWORD } = fx;
const NEW_PASSWORD = 'New-Passw0rd!2';
const hashOf = (token) => crypto.createHash('sha256').update(token).digest('hex');

const signIn = (emp) => authService.loginToPortal('employee', emp.email, PASSWORD, null);

const failureOf = async (promise) => {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error('expected the call to fail');
};

/** Runs the real auth middleware on an access token; resolves to the error, or null when it passes. */
const checkAccess = async (accessToken) => {
  let outcome;
  await authenticate({ cookies: { accessToken }, headers: {} }, {}, (err) => { outcome = err || null; });
  return outcome;
};

/** Moves the clock forward, so tokens signed afterwards differ from earlier ones. */
const realNow = Date.now.bind(Date);
const moveClock = (ms) => jest.spyOn(Date, 'now').mockImplementation(() => realNow() + ms);
afterEach(() => jest.restoreAllMocks());

const refreshTokenFor = (emp, tokenVersion) => jwt.sign(
  { id: emp.id, email: emp.email, role: emp.role, company_id: emp.company_id, token_version: tokenVersion },
  process.env.JWT_REFRESH_SECRET,
  { expiresIn: '7d', jwtid: crypto.randomUUID() },
);

describe('password change', () => {
  test('another session\'s refresh token stops working', async () => {
    const emp = fx.makeEmployee();
    fx.seed([emp]);
    const stolen = await signIn(emp); // the attacker's copy
    moveClock(2000);
    await signIn(emp); // the person's own session

    await authService.changePassword(emp.id, PASSWORD, NEW_PASSWORD);

    const err = await failureOf(authService.refreshAccessToken(stolen.refreshToken));
    expect(err.statusCode).toBe(401);
    expect(err.message).toBe('Your session has ended. Please sign in again.');
    expect(await checkAccess(stolen.accessToken)).toMatchObject({ statusCode: 401 });
    expect(fx.refreshRowsFor(emp.id)).toHaveLength(0);
  });

  test('the session that changed the password keeps working, and only that one', async () => {
    const emp = fx.makeEmployee();
    fx.seed([emp]);
    const other = await signIn(emp);
    moveClock(2000);
    const mine = await signIn(emp);
    moveClock(4000);

    const { res, error } = await fx.runHandler(authController.changePassword, {
      user: { id: emp.id, role: emp.role, company_id: emp.company_id },
      cookies: { accessToken: mine.accessToken, refreshToken: mine.refreshToken },
      body: { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
    });
    expect(error).toBeNull();
    expect(res.cookies.accessToken).toBeTruthy();
    expect(res.cookies.refreshToken).toBeTruthy();

    // The fresh session passes the auth middleware and can refresh…
    expect(await checkAccess(res.cookies.accessToken)).toBeNull();
    const refreshed = await authService.refreshAccessToken(res.cookies.refreshToken);
    expect(await checkAccess(refreshed.accessToken)).toBeNull();
    // …while the old cookies of both sessions are dead.
    expect(await checkAccess(mine.accessToken)).toMatchObject({ statusCode: 401 });
    await expect(authService.refreshAccessToken(mine.refreshToken)).rejects.toMatchObject({ statusCode: 401 });
    await expect(authService.refreshAccessToken(other.refreshToken)).rejects.toMatchObject({ statusCode: 401 });
    // The stale tokens were not treated as reuse: the live session survives.
    expect(await checkAccess(refreshed.accessToken)).toBeNull();
  });
});

describe('password reset (forgot password)', () => {
  test('signs out everywhere', async () => {
    const emp = fx.makeEmployee();
    const otp = '123456';
    fx.seed([emp], {
      password_reset_tokens: [{
        id: fx.newId(), employee_id: emp.id, token_hash: hashOf(otp), used: false,
        expires_at: new Date(Date.now() + 600000).toISOString(),
      }],
    });
    const session = await signIn(emp);

    await authService.resetPassword(emp.email, otp, NEW_PASSWORD, null);

    expect(fx.employeeRow(emp.id).token_version).toBe(1);
    expect(fx.refreshRowsFor(emp.id)).toHaveLength(0);
    await expect(authService.refreshAccessToken(session.refreshToken)).rejects.toMatchObject({ statusCode: 401 });
    expect(await checkAccess(session.accessToken)).toMatchObject({ statusCode: 401 });
  });
});

describe('refresh', () => {
  test('rotates: the new token works, the used one is reuse and ends everything', async () => {
    const emp = fx.makeEmployee();
    fx.seed([emp]);
    const first = await signIn(emp);

    const second = await authService.refreshAccessToken(first.refreshToken);
    expect(second.refreshToken).not.toBe(first.refreshToken);

    const reuse = await failureOf(authService.refreshAccessToken(first.refreshToken));
    expect(reuse.message).toBe('Session invalidated due to token reuse');
    expect(fx.employeeRow(emp.id).token_version).toBe(1);
    expect(fx.refreshRowsFor(emp.id)).toHaveLength(0);
    await expect(authService.refreshAccessToken(second.refreshToken)).rejects.toMatchObject({ statusCode: 401 });
  });

  test('token reuse never lowers token_version', async () => {
    const emp = fx.makeEmployee({ token_version: 7 });
    fx.seed([emp]);
    db.tables.refresh_tokens.push({
      id: fx.newId(), employee_id: emp.id, token_hash: 'another-device', expires_at: new Date(Date.now() + 86400000).toISOString(),
    });

    // An old token (version 2): refused, and the stored version is untouched —
    // the old code wrote 2 + 1 = 3 here, reviving every version-3 token.
    await expect(authService.refreshAccessToken(refreshTokenFor(emp, 2))).rejects.toMatchObject({ statusCode: 401 });
    expect(fx.employeeRow(emp.id).token_version).toBe(7);

    // A current-version token with no row (already used): raised from the
    // database's 7, and every refresh token is gone.
    const err = await failureOf(authService.refreshAccessToken(refreshTokenFor(emp, 7)));
    expect(err.message).toBe('Session invalidated due to token reuse');
    expect(fx.employeeRow(emp.id).token_version).toBe(8);
    expect(fx.refreshRowsFor(emp.id)).toHaveLength(0);
  });

  test('is refused for a deactivated employee', async () => {
    const emp = fx.makeEmployee();
    fx.seed([emp]);
    const session = await signIn(emp);
    fx.employeeRow(emp.id).is_active = false;

    await expect(authService.refreshAccessToken(session.refreshToken)).rejects.toMatchObject({ statusCode: 401 });
    expect(fx.refreshRowsFor(emp.id)).toHaveLength(0);
  });

  test('two requests with the same token can not both get a session', async () => {
    const emp = fx.makeEmployee();
    fx.seed([emp]);
    const session = await signIn(emp);

    const results = await Promise.allSettled([
      authService.refreshAccessToken(session.refreshToken),
      authService.refreshAccessToken(session.refreshToken),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });
});

describe('bumpTokenVersion (sign out everywhere)', () => {
  test('raises the version from the database and deletes every refresh token', async () => {
    const emp = fx.makeEmployee({ token_version: 3 });
    fx.seed([emp]);
    await signIn(emp);
    await signIn(emp);
    expect(fx.refreshRowsFor(emp.id)).toHaveLength(2);

    await authService.bumpTokenVersion(emp.id);
    expect(fx.employeeRow(emp.id).token_version).toBe(4);
    expect(fx.refreshRowsFor(emp.id)).toHaveLength(0);
  });

  test('concurrent bumps each count — none is lost', async () => {
    const emp = fx.makeEmployee({ token_version: 3 });
    fx.seed([emp]);
    await Promise.all([1, 2, 3].map(() => authService.bumpTokenVersion(emp.id)));
    expect(fx.employeeRow(emp.id).token_version).toBe(6);
  });

  test('logout ends every refresh token', async () => {
    const emp = fx.makeEmployee();
    fx.seed([emp]);
    const session = await signIn(emp);

    const { error } = await fx.runHandler(authController.logout, {
      user: { id: emp.id }, cookies: { refreshToken: session.refreshToken },
    });
    expect(error).toBeNull();
    expect(fx.refreshRowsFor(emp.id)).toHaveLength(0);
    await expect(authService.refreshAccessToken(session.refreshToken)).rejects.toMatchObject({ statusCode: 401 });
  });
});
