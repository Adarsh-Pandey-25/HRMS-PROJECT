const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { supabaseAdmin } = require('../config/supabase');
const config = require('../config/database');
const {
  BadRequestError, UnauthorizedError, NotFoundError, ForbiddenError, TooManyRequestsError, ConflictError,
} = require('../utils/errors');
const { omitSensitive, generateDefaultPassword, isMissingColumnError } = require('../utils/helpers');
const { checkSlugAvailability } = require('../utils/slug');
const { allocateNextEmployeeCode } = require('./employeeCode.service');
const { welcomeEmail, passwordResetEmail, onboardingOtpEmail, sendEmail } = require('./email.service');
const settingsService = require('./settings.service');
const logger = require('../utils/logger');
const totp = require('../utils/totp');
const { getCompanyId, newCompanyId, companyIdFields } = require('../utils/tenant');
const tenantService = require('./tenant.service');
const { uploadCompanyLogo, getSignedUrl, STORAGE_BUCKETS } = require('./storage.service');

const SALT_ROUNDS = 10;

// ── Per-email login brute-force protection ──────────────────────────────────
/** Thresholds: [failedAttempts → lockDurationMs] */
const LOGIN_LOCK_THRESHOLDS = [
  { attempts: 5,  lockMs: 15 * 60 * 1000 },  // 15 minutes
  { attempts: 10, lockMs: 60 * 60 * 1000 },  // 1 hour
  { attempts: 20, lockMs: 24 * 60 * 60 * 1000 }, // 24 hours
];

/** In-memory per-email lockout tracker. Cleared on process restart (OTPs are too). */
const loginAttempts = new Map();

/** Normalize email for use as a map key. */
const loginEmailKey = (email) => String(email || '').trim().toLowerCase();

/** Compute lock duration for the given number of failed attempts. */
const getLoginLockDuration = (failedCount) => {
  let lockMs = 0;
  for (const t of LOGIN_LOCK_THRESHOLDS) {
    if (failedCount >= t.attempts) lockMs = t.lockMs;
  }
  return lockMs;
};

/** Record a failed login attempt for an email. Returns lock info or null. */
const recordLoginFailure = (email) => {
  const key = loginEmailKey(email);
  const entry = loginAttempts.get(key) || { failedAttempts: 0, lockedUntil: 0 };
  entry.failedAttempts += 1;
  const lockMs = getLoginLockDuration(entry.failedAttempts);
  if (lockMs > 0) {
    entry.lockedUntil = Date.now() + lockMs;
  }
  loginAttempts.set(key, entry);
  return entry;
};

/** Reset login attempt counter on successful authentication. */
const resetLoginAttempts = (email) => {
  loginAttempts.delete(loginEmailKey(email));
};

/** Check if an email is currently locked. Throws TooManyRequestsError if locked.
    Uses a generic error message — does NOT reveal whether the email exists. */
const assertEmailNotLoginLocked = (email) => {
  const entry = loginAttempts.get(loginEmailKey(email));
  if (entry && entry.lockedUntil > Date.now()) {
    throw new TooManyRequestsError(
      'Too many failed login attempts. Please try again later.',
    );
  }
  // Expired lock — clear it
  if (entry && entry.lockedUntil > 0 && entry.lockedUntil <= Date.now()) {
    loginAttempts.delete(loginEmailKey(email));
  }
};

/** Periodic cleanup of stale entries to prevent memory leak. */
const startLoginAttemptCleanup = () => {
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of loginAttempts.entries()) {
      if (entry.lockedUntil > 0 && entry.lockedUntil <= now) {
        loginAttempts.delete(key);
      }
    }
  }, 5 * 60 * 1000); // every 5 minutes
};
startLoginAttemptCleanup();
// ── End per-email login brute-force protection ──────────────────────────────

/** Max wrong OTP tries before a progressive lockout. */
const OTP_MAX_ATTEMPTS = 3;
/** Lock / resend waits after failed OTP batches: 1m → 3m → 10m */
const OTP_WAIT_SECONDS = [60, 180, 600];

/** In-memory OTP guards keyed by normalized email (survives for process lifetime). */
const otpGuards = new Map();

const normalizeEmailKey = (email) => String(email || '').trim().toLowerCase();

/**
 * Email is no longer globally unique — the same address can legitimately
 * belong to two different companies. Without a scope key, two unrelated
 * people sharing an email would share one OTP lockout/cooldown state,
 * letting one interfere with the other's password-reset attempts. `scopeKey`
 * is the resolved tenant company id when known; requests that arrive with no
 * resolved subdomain (the common case until BASE_DOMAIN/wildcard DNS are
 * live) all collapse to the same 'unscoped' bucket, same as before.
 */
const otpGuardKey = (email, scopeKey) => `${scopeKey || 'unscoped'}:${normalizeEmailKey(email)}`;

const getOtpGuard = (email, scopeKey = null) => {
  const key = otpGuardKey(email, scopeKey);
  if (!otpGuards.has(key)) {
    otpGuards.set(key, {
      failedAttempts: 0,
      lockLevel: 0,
      lockedUntil: 0,
      resendCount: 0,
      nextResendAt: 0,
    });
  }
  return otpGuards.get(key);
};

const clearOtpGuard = (email, scopeKey = null) => {
  otpGuards.delete(otpGuardKey(email, scopeKey));
};

const waitLabel = (seconds) => {
  const s = Math.max(1, Math.ceil(Number(seconds) || 0));
  if (s < 60) return `${s} second${s === 1 ? '' : 's'}`;
  const m = Math.ceil(s / 60);
  return `${m} minute${m === 1 ? '' : 's'}`;
};

const lockDetails = (guard, extra = {}) => {
  const retryAfterSeconds = Math.max(0, Math.ceil((guard.lockedUntil - Date.now()) / 1000));
  return {
    attemptsRemaining: Math.max(0, OTP_MAX_ATTEMPTS - guard.failedAttempts),
    lockedUntil: guard.lockedUntil || null,
    retryAfterSeconds,
    lockLevel: guard.lockLevel,
    ...extra,
  };
};

const assertNotOtpLocked = (email, scopeKey = null) => {
  const guard = getOtpGuard(email, scopeKey);
  const now = Date.now();
  if (guard.lockedUntil > now) {
    const retryAfterSeconds = Math.ceil((guard.lockedUntil - now) / 1000);
    throw new TooManyRequestsError(
      `Too many wrong OTPs. Try again in ${waitLabel(retryAfterSeconds)}.`,
      lockDetails(guard, { retryAfterSeconds }),
    );
  }
  if (guard.lockedUntil && guard.lockedUntil <= now) {
    guard.lockedUntil = 0;
  }
  return guard;
};

const hashPassword = (password) => bcrypt.hash(password, SALT_ROUNDS);
const comparePassword = (password, hash) => bcrypt.compare(password, hash);

const assertPasswordPolicy = async (password, companyId = null) => {
  const cfg = await settingsService.getSetting('security_config', null, companyId);
  const minLength = Number(cfg?.passwordMinLength ?? cfg?.password_min_length ?? 8);
  const requireUpper = cfg?.passwordRequireUppercase ?? cfg?.password_require_uppercase ?? true;
  const requireLower = cfg?.passwordRequireLowercase ?? cfg?.password_require_lowercase ?? true;
  const requireSpecial = cfg?.passwordRequireSpecialChar ?? cfg?.password_require_special_char ?? true;
  const requireNumber = cfg?.passwordRequireNumber ?? cfg?.password_require_number ?? true;

  if (!password || password.length < Math.max(1, minLength)) {
    throw new BadRequestError(`Password must be at least ${minLength} characters`);
  }
  // Audit finding L-04: previously the policy only checked length + a
  // single character class. A 64-char all-letter password passed. The
  // expanded rules below raise the cost of an online guess to something
  // closer to the entropy the password-length UI already implies.
  if (requireUpper && !/[A-Z]/.test(password)) {
    throw new BadRequestError('Password does not meet complexity requirements');
  }
  if (requireLower && !/[a-z]/.test(password)) {
    throw new BadRequestError('Password does not meet complexity requirements');
  }
  if (requireSpecial && !/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password)) {
    throw new BadRequestError('Password does not meet complexity requirements');
  }
  if (requireNumber && !/\d/.test(password)) {
    throw new BadRequestError('Password does not meet complexity requirements');
  }
};

const generateTokens = (employee) => {
  const payload = {
    id: employee.id,
    email: employee.email,
    role: employee.role,
    company_id: getCompanyId(employee),
    // Audit finding N-12: carried so auth.middleware.js can reject a token
    // whose version no longer matches the DB (bumped on logout/password
    // change/deactivation). ?? 0 matches employees.token_version's default
    // so a pre-migration/undefined value never mismatches.
    token_version: employee.token_version ?? 0,
  };
  const accessToken = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: config.jwt.expire });
  // A unique id, so two refresh tokens issued in the same second never share a hash.
  const refreshToken = jwt.sign(payload, process.env.JWT_REFRESH_SECRET, {
    expiresIn: config.jwt.refreshExpire,
    jwtid: crypto.randomUUID(),
  });
  return { accessToken, refreshToken };
};

const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

/** UUIDs can arrive upper- or lower-case; compare them the way Postgres does. */
const sameId = (a, b) => Boolean(a && b) && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

/** Deletes every refresh token the employee holds, so no device can mint a new session. */
const revokeRefreshTokens = async (employeeId) => {
  const { error } = await supabaseAdmin.from('refresh_tokens').delete().eq('employee_id', employeeId);
  if (error) logger.error('Failed to revoke refresh tokens', { employeeId, error: error.message });
};

const generateOnboardingToken = (employee) => {
  const payload = {
    employee_id: employee.id,
    company_id: getCompanyId(employee),
    scope: 'onboarding',
  };
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '72h' });
};

const storeRefreshToken = async (employeeId, refreshToken) => {
  const tokenHash = hashToken(refreshToken);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await supabaseAdmin.from('refresh_tokens').insert({
    employee_id: employeeId,
    token_hash: tokenHash,
    expires_at: expiresAt.toISOString(),
  });
};

// ── Two-step login (employee TOTP) ──────────────────────────────────────────
// After the password, the client gets a pending token (5 minutes) and must
// send it back with a code from the authenticator app. Each pending token is
// a row in two_fa_login_challenges: that row makes it single-use and caps it
// at 5 tries, in the database, so it holds across every backend process.

const TWO_FA_PENDING_PURPOSE = '2fa_pending';
const TWO_FA_PENDING_TTL_SECONDS = 5 * 60;
const TWO_FA_MAX_ATTEMPTS = 5;
const TWO_FA_CHALLENGES = 'two_fa_login_challenges';
/** Tells the login screen to go back to the password step. */
const TWO_FA_RESTART = { restartLogin: true };
const TWO_FA_EXPIRED_MESSAGE = 'Your sign-in has expired. Please sign in again.';
const TWO_FA_USED_MESSAGE = 'This sign-in has already been used. Please sign in again.';
const TWO_FA_TOO_MANY_MESSAGE = 'Too many wrong codes. Please sign in again.';

/**
 * The pending token is signed with its own key, derived from JWT_SECRET, so
 * it can never pass as an access token (auth.middleware.js verifies with
 * JWT_SECRET itself) and an access token can never pass as a pending token.
 */
const twoFaPendingKey = () => {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is not set');
  return crypto.createHmac('sha256', process.env.JWT_SECRET).update('spaxsync:employee-2fa-pending:v1').digest();
};

const restartTwoFa = (message = TWO_FA_EXPIRED_MESSAGE) => new BadRequestError(message, { ...TWO_FA_RESTART });
const tooManyTwoFaTries = () => new TooManyRequestsError(TWO_FA_TOO_MANY_MESSAGE, { ...TWO_FA_RESTART, attemptsRemaining: 0 });

const issueTwoFaPendingToken = async (employee) => {
  const jti = crypto.randomUUID();
  const companyId = getCompanyId(employee);
  const now = Date.now();
  // Housekeeping: this employee's expired challenges are of no further use.
  await supabaseAdmin.from(TWO_FA_CHALLENGES).delete()
    .eq('employee_id', employee.id)
    .lt('expires_at', new Date(now).toISOString());
  const { error } = await supabaseAdmin.from(TWO_FA_CHALLENGES).insert({
    jti,
    employee_id: employee.id,
    company_id: companyId,
    attempts: 0,
    expires_at: new Date(now + TWO_FA_PENDING_TTL_SECONDS * 1000).toISOString(),
  });
  if (error) {
    logger.error('[2FA] Could not start two-step sign-in — is migration 20261117_two_step_login.sql applied?', {
      employeeId: employee.id, error: error.message,
    });
    throw new Error('Two-step sign-in is unavailable');
  }
  return jwt.sign(
    {
      id: employee.id,
      company_id: companyId,
      token_version: employee.token_version ?? 0,
      purpose: TWO_FA_PENDING_PURPOSE,
      // Also refused by auth.middleware.js, should this ever reach it.
      scope: 'two_fa_pending',
    },
    twoFaPendingKey(),
    { algorithm: 'HS256', expiresIn: TWO_FA_PENDING_TTL_SECONDS, jwtid: jti },
  );
};

/** Verifies a pending token's signature, expiry and purpose. Never accepts an access token. */
const readTwoFaPendingToken = (token) => {
  let claims;
  try {
    claims = jwt.verify(String(token || ''), twoFaPendingKey(), { algorithms: ['HS256'] });
  } catch {
    throw restartTwoFa();
  }
  if (claims?.purpose !== TWO_FA_PENDING_PURPOSE || !claims.jti || !claims.id) throw restartTwoFa();
  return claims;
};

/**
 * Uses up one of the challenge's tries BEFORE the code is checked, with a
 * compare-and-set, so parallel guesses can't get past the limit. Returns how
 * many tries are now used.
 */
const reserveTwoFaAttempt = async (jti, seenAttempts) => {
  let attempts = Number(seenAttempts) || 0;
  while (attempts < TWO_FA_MAX_ATTEMPTS) {
    const { data, error } = await supabaseAdmin.from(TWO_FA_CHALLENGES)
      .update({ attempts: attempts + 1 })
      .eq('jti', jti)
      .eq('attempts', attempts)
      .is('used_at', null)
      .select('jti');
    if (error) {
      logger.error('[2FA] Could not record a sign-in attempt', { error: error.message });
      throw restartTwoFa('Something went wrong. Please sign in again.');
    }
    if (data?.length) return attempts + 1;
    // Another try landed at the same moment: read the count again.
    const { data: fresh } = await supabaseAdmin.from(TWO_FA_CHALLENGES)
      .select('attempts, used_at')
      .eq('jti', jti)
      .maybeSingle();
    if (!fresh) throw restartTwoFa();
    if (fresh.used_at) throw restartTwoFa(TWO_FA_USED_MESSAGE);
    attempts = Number(fresh.attempts) || 0;
  }
  throw tooManyTwoFaTries();
};

/** The TOTP step the code matches, or null. A secret that can't be decrypted is logged, never shown. */
const matchEmployeeTotpStep = (employee, code) => {
  try {
    return totp.matchTotpStep(totp.decryptSecret(employee.totp_secret), code);
  } catch (err) {
    // Not a wrong code: the stored seed can't be read, almost always because
    // SUPER_ADMIN_2FA_ENC_KEY changed since enrollment. Without this log every
    // 2FA user is locked out and nothing says why.
    logger.error(
      '[Employee2FA] TOTP secret decryption failed — SUPER_ADMIN_2FA_ENC_KEY may have changed since enrollment. '
      + 'This employee cannot finish signing in until the original key is restored or their two-step login is reset.',
      { employeeId: employee.id, error: err.message },
    );
    return null;
  }
};

/**
 * Replay protection: a code is accepted only if its step is later than the
 * last one this account signed in with, so a code someone watched being
 * typed can't be used again in the same 90 seconds.
 */
const claimTotpStep = async (employeeId, step) => {
  const { data, error } = await supabaseAdmin.from('employees')
    .update({ totp_last_used_step: step })
    .eq('id', employeeId)
    .or(`totp_last_used_step.is.null,totp_last_used_step.lt.${Number(step)}`)
    .select('id');
  if (error) {
    if (isMissingColumnError(error.message, 'totp_last_used_step')) {
      logger.warn('[2FA] Code replay check skipped — run migration 20261117_two_step_login.sql');
      return true;
    }
    logger.error('[2FA] Could not record the code step', { employeeId, error: error.message });
    throw restartTwoFa('Something went wrong. Please sign in again.');
  }
  return Boolean(data?.length);
};

/** Roles allowed to sign in through each subdomain portal path. Manager rides on the employee portal — it isn't a separate administrative surface. */
const PORTAL_ALLOWED_ROLES = {
  admin: ['admin'],
  hr: ['hr'],
  employee: ['employee', 'manager'],
};

/**
 * Shared login core. `tenantCompanyId` scopes the email lookup to one
 * tenant when the request arrived on a resolved subdomain — this is also
 * what lets the same email exist at two different companies, since the
 * lookup is no longer necessarily global. `allowedRoles`, when given,
 * enforces that this account's role matches the portal path it logged in
 * through (checked only AFTER the password itself is verified). The
 * mismatch throws the exact same error (class, message, status) as a wrong
 * password — a distinguishable response here would let anyone holding a
 * stolen credential pair probe all three portals to confirm the password is
 * correct without ever needing to get the portal right, i.e. a
 * password-correctness oracle that never even touches a session.
 */
/**
 * Item 4: explicit product decision — fail CLOSED. No subscription row at
 * all, or a status outside active/trialing, blocks login entirely. This is
 * the opposite convention from every OTHER gate this session (seat check,
 * feature gating, export gate all fail OPEN with no subscription) —
 * deliberately, per instruction, since login itself is the one place a
 * genuinely unpaid/inactive company must not be let in at all. Checked
 * before password comparison, same position as the existing company
 * is_active check right below this function's call site — consistent with
 * that established pattern in this exact function.
 *
 * Simpler "blocked on next login/refresh" over immediate token_version
 * cutoff (N-12) — chosen per the task's own stated preference: N-12's
 * mechanism would need bumping token_version for every employee at a
 * company on every subscription status transition (suspend, cancel, the
 * daily billing cron marking something past_due/expired) — a materially
 * bigger, more invasive change across subscription.service.js and the
 * billing cron, not a natural fit for a single login-time check.
 */
const GOOD_STANDING_STATUSES = ['active', 'trialing'];
const HR_ADMIN_STATUS_MESSAGES = {
  trialing: null, // never actually shown — allowed
  active: null, // never actually shown — allowed
  past_due: "Your company's subscription payment is past due. Contact billing to resolve this.",
  grace_period: "Your company's subscription is in a grace period due to a payment issue. Contact billing to resolve this.",
  suspended: "Your company's account has been deactivated. Contact billing to resolve this.",
  cancelled: "Your company's subscription has been cancelled. Contact billing to resolve this.",
  expired: "Your company's subscription has expired. Contact billing to resolve this.",
};
const EMPLOYEE_GENERIC_MESSAGE = 'Some problem occurred. Please contact your HR/Admin.';

const assertCompanyInGoodStanding = async (companyId, role) => {
  if (!companyId) return;
  const { data: subscription } = await supabaseAdmin
    .from('company_billing_subscriptions')
    .select('status')
    .eq('company_id', companyId)
    .in('status', ['trialing', 'active', 'past_due', 'grace_period', 'suspended', 'cancelled', 'expired'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const status = subscription?.status || null;
  if (status && GOOD_STANDING_STATUSES.includes(status)) return;

  const isHrOrAdmin = role === 'admin' || role === 'hr';
  if (isHrOrAdmin) {
    const message = status
      ? (HR_ADMIN_STATUS_MESSAGES[status] || "Your company's subscription is not active. Contact billing to resolve this.")
      : "Your company doesn't have an active subscription. Contact your platform administrator.";
    throw new ForbiddenError(message);
  }
  throw new ForbiddenError(EMPLOYEE_GENERIC_MESSAGE);
};

const authenticateEmployee = async (email, password, { tenantCompanyId = null, allowedRoles = null } = {}) => {
  // Per-email brute-force guard — same generic error as wrong password so
  // attackers cannot distinguish "locked" from "bad credentials".
  assertEmailNotLoginLocked(email);

  let query = supabaseAdmin.from('employees').select('*').eq('email', email);
  if (tenantCompanyId) query = query.eq('company_id', tenantCompanyId);
  const { data: candidates, error } = await query;

  if (error || !candidates?.length) {
    recordLoginFailure(email);
    throw new UnauthorizedError('Invalid email or password');
  }

  // A scoped query (portal login, tenantCompanyId set) can only ever match
  // one row — company_id+email is unique at the DB level. Only the legacy
  // unscoped /login can land here with more than one candidate, once the
  // same email exists at two companies. Rather than fail closed for BOTH
  // accounts, try the password against each one — only after it actually
  // matches a candidate do we say anything more specific than "Invalid
  // email or password", so this can't be used to enumerate which emails
  // are shared across companies.
  let employee = candidates[0];
  if (candidates.length > 1) {
    const results = await Promise.all(
      candidates.map(async (c) => ((await comparePassword(password, c.password_hash)) ? c : null))
    );
    const matches = results.filter(Boolean);
    if (matches.length === 1) {
      employee = matches[0];
    } else if (matches.length > 1) {
      recordLoginFailure(email);
      throw new UnauthorizedError(
        "This email is registered at more than one company. Please sign in through your company's own login page instead of the general sign-in.",
      );
    } else {
      recordLoginFailure(email);
      throw new UnauthorizedError('Invalid email or password');
    }
  }

  // Prove the password BEFORE any account- or company-state check. Those
  // checks throw distinct, descriptive errors ("Account is deactivated",
  // "subscription is not active"), so running them first let anyone with
  // just an email address — no password — learn whether an account exists,
  // whether it is active, and what the company's billing status is.
  //
  // The multi-candidate branch above already proved the password against the
  // row it selected, so skip a second bcrypt compare in that case.
  if (candidates.length === 1) {
    const valid = await comparePassword(password, employee.password_hash);
    if (!valid) {
      recordLoginFailure(email);
      throw new UnauthorizedError('Invalid email or password');
    }
  }

  if (!employee.is_active) {
    recordLoginFailure(email);
    throw new ForbiddenError('Account is deactivated');
  }

  const companyId = getCompanyId(employee);
  if (companyId) {
    const { data: company } = await supabaseAdmin
      .from('companies')
      .select('id, is_active')
      .eq('id', companyId)
      .maybeSingle();
    if (company && company.is_active === false) {
      throw new ForbiddenError('This company workspace is deactivated. Contact your platform administrator.');
    }
    await assertCompanyInGoodStanding(companyId, employee.role);
  }

  // A temp password (single-create, bulk import) is time-boxed — checked
  // here, not just stated in the welcome/bulk-import email copy. `select('*')`
  // above means this is simply `undefined` pre-migration, so this is
  // inert until 20260910_temp_password_expiry.sql lands, never a crash.
  if (employee.must_change_password && employee.temp_password_expires_at
    && new Date(employee.temp_password_expires_at).getTime() < Date.now()) {
    throw new UnauthorizedError('Your temporary password has expired. Contact HR to get a new one.');
  }

  // Authorization is checked only now — after identity is proven, before any
  // session is issued. A correct password for the wrong portal throws the
  // exact same error as a wrong password (same class, message, status) —
  // see the docblock above for why a distinguishable response here is itself
  // a vulnerability.
  if (allowedRoles && !allowedRoles.includes(employee.role)) {
    recordLoginFailure(email);
    throw new UnauthorizedError('Invalid email or password');
  }

  // Two-step login: only after every check above (temp-password expiry and
  // the portal's role included), and nothing about the account goes back
  // until the code is verified — just the pending token for the code screen.
  // The lockout counter is cleared only once the code passes, so wrong codes
  // add to the same per-email lockout as wrong passwords.
  if (employee.two_fa_enabled) {
    return { requires2FA: true, twoFaToken: await issueTwoFaPendingToken(employee) };
  }

  // Successful authentication — clear any prior lockout for this email.
  resetLoginAttempts(email);

  const { accessToken, refreshToken } = generateTokens(employee);
  await storeRefreshToken(employee.id, refreshToken);

  return {
    employee: {
      ...omitSensitive(employee, ['password_hash']),
      company_id: companyId,
      must_change_password: Boolean(employee.must_change_password),
    },
    accessToken,
    refreshToken,
  };
};

/** Legacy unscoped login — any role, no tenant scoping. Kept for any existing caller. */
const login = async (email, password, tenantCompanyId = null) => authenticateEmployee(email, password, { tenantCompanyId });

/** Portal-specific logins: role is enforced server-side, company is scoped from the resolved subdomain when present. */
const loginToPortal = async (portal, email, password, tenantCompanyId = null) => {
  const allowedRoles = PORTAL_ALLOWED_ROLES[portal];
  if (!allowedRoles) throw new BadRequestError('Unknown login portal');
  return authenticateEmployee(email, password, { tenantCompanyId, allowedRoles });
};

const SESSION_ENDED_MESSAGE = 'Your session has ended. Please sign in again.';

/**
 * Audit #6: a refresh token is only as good as the session it belongs to.
 * The employee's current token_version is checked on every refresh, so a
 * password change/reset, logout, deactivation or two-step reset ends it —
 * including a refresh cookie someone copied earlier.
 */
const refreshAccessToken = async (refreshToken, tenantCompanyId = null) => {
  if (!refreshToken) throw new UnauthorizedError('Refresh token required');

  let decoded;
  try {
    decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET, { algorithms: ['HS256'] });
  } catch {
    throw new UnauthorizedError('Invalid refresh token');
  }
  if (!decoded?.id) throw new UnauthorizedError('Invalid refresh token');

  const tokenHash = hashToken(refreshToken);

  const { data: employee } = await supabaseAdmin
    .from('employees')
    .select('*')
    .eq('id', decoded.id)
    .maybeSingle();

  if (!employee || !employee.is_active) {
    if (employee) await revokeRefreshTokens(employee.id);
    throw new UnauthorizedError(SESSION_ENDED_MESSAGE);
  }
  if (tenantCompanyId && !sameId(getCompanyId(employee), tenantCompanyId)) {
    throw new UnauthorizedError('Invalid refresh token');
  }

  // Issued before the last sign-out-everywhere: this session is over. That
  // is not reuse, so the session that is still valid (say, the one that
  // just changed the password) is left alone.
  if ((decoded.token_version ?? 0) !== (employee.token_version ?? 0)) {
    await supabaseAdmin.from('refresh_tokens').delete()
      .eq('employee_id', employee.id)
      .eq('token_hash', tokenHash);
    throw new UnauthorizedError(SESSION_ENDED_MESSAGE);
  }

  // Claim the token: delete its row and get it back in one statement, so two
  // requests with the same token can't both get a new session.
  const { data: claimed, error: claimError } = await supabaseAdmin
    .from('refresh_tokens')
    .delete()
    .eq('employee_id', employee.id)
    .eq('token_hash', tokenHash)
    .select('id, expires_at');
  if (claimError) {
    // A database hiccup is not token reuse — don't sign the person out everywhere for it.
    logger.error('Refresh token claim failed', { employeeId: employee.id, error: claimError.message });
    throw new UnauthorizedError(SESSION_ENDED_MESSAGE);
  }

  if (!claimed?.length) {
    // A current-version token with no row was already used (rotated): a copy
    // exists somewhere. Sign out everywhere. The version is raised from the
    // database's value, never from the token's, so it can only go up.
    await bumpTokenVersion(employee.id);
    throw new UnauthorizedError('Session invalidated due to token reuse');
  }
  if (!claimed.some((row) => new Date(row.expires_at).getTime() > Date.now())) {
    throw new UnauthorizedError(SESSION_ENDED_MESSAGE);
  }

  // Item 4: same fail-closed check as login, run again here so "blocked on
  // next login/refresh" actually means refresh too — a long-lived refresh
  // token would otherwise keep silently minting new access tokens for a
  // company whose subscription lapsed after the original login.
  await assertCompanyInGoodStanding(getCompanyId(employee), employee.role);

  const { accessToken, refreshToken: newRefresh } = generateTokens(employee);
  await storeRefreshToken(employee.id, newRefresh);

  return {
    accessToken,
    refreshToken: newRefresh,
    employee: omitSensitive(employee, ['password_hash', 'totp_secret']),
  };
};

/**
 * Complete 2FA login — called after password succeeded and TOTP code
 * is verified. Loads employee, issues fresh session tokens.
 */
const completeTwoFaLogin = async (employeeId) => {
  const { data: employee, error } = await supabaseAdmin
    .from('employees')
    .select('*')
    .eq('id', employeeId)
    .eq('is_active', true)
    .single();

  if (error || !employee) throw new UnauthorizedError('User not found');

  const companyId = getCompanyId(employee);
  await assertCompanyInGoodStanding(companyId, employee.role);

  const { accessToken, refreshToken } = generateTokens(employee);
  await storeRefreshToken(employee.id, refreshToken);

  return {
    accessToken,
    refreshToken,
    employee: {
      ...omitSensitive(employee, ['password_hash', 'totp_secret']),
      company_id: companyId,
    },
  };
};

/**
 * Second login step: the pending token from the password step plus a code
 * from the authenticator app. Wrong codes count against the challenge (5,
 * then sign in again) and against the per-email login lockout. On success
 * the challenge is spent, so the same pending token can never sign in twice.
 */
const verifyTwoFaLogin = async (twoFaToken, code, tenantCompanyId = null) => {
  const claims = readTwoFaPendingToken(twoFaToken);
  if (tenantCompanyId && !sameId(claims.company_id, tenantCompanyId)) throw restartTwoFa();

  const { data: challenge, error } = await supabaseAdmin
    .from(TWO_FA_CHALLENGES)
    .select('jti, employee_id, company_id, attempts, expires_at, used_at')
    .eq('jti', claims.jti)
    .maybeSingle();
  if (error) logger.error('[2FA] Could not read the sign-in challenge', { error: error.message });
  if (!challenge || !sameId(challenge.employee_id, claims.id) || !sameId(challenge.company_id, claims.company_id)) {
    throw restartTwoFa();
  }
  if (challenge.used_at) throw restartTwoFa(TWO_FA_USED_MESSAGE);
  if (new Date(challenge.expires_at).getTime() <= Date.now()) throw restartTwoFa();
  if (challenge.attempts >= TWO_FA_MAX_ATTEMPTS) throw tooManyTwoFaTries();

  const { data: employee } = await supabaseAdmin
    .from('employees')
    .select('*')
    .eq('id', challenge.employee_id)
    .eq('company_id', challenge.company_id)
    .maybeSingle();
  // Signed out everywhere, deactivated or two-step reset since the password step.
  if (!employee || !employee.is_active || !employee.two_fa_enabled || !employee.totp_secret
    || (employee.token_version ?? 0) !== (claims.token_version ?? 0)) {
    throw restartTwoFa();
  }

  try {
    assertEmailNotLoginLocked(employee.email);
  } catch (err) {
    throw new TooManyRequestsError(err.message, { ...TWO_FA_RESTART });
  }

  const used = await reserveTwoFaAttempt(challenge.jti, challenge.attempts);
  const left = TWO_FA_MAX_ATTEMPTS - used;

  const step = matchEmployeeTotpStep(employee, code);
  const accepted = step !== null && await claimTotpStep(employee.id, step);
  if (!accepted) {
    recordLoginFailure(employee.email);
    if (left <= 0) throw tooManyTwoFaTries();
    const reason = step === null
      ? "That code didn't work."
      : 'That code has already been used. Wait for the next code in your app.';
    throw new BadRequestError(`${reason} ${left} attempt${left === 1 ? '' : 's'} left.`, { attemptsRemaining: left });
  }

  // Single use: only one request can ever turn this challenge into a session.
  const { data: spent } = await supabaseAdmin
    .from(TWO_FA_CHALLENGES)
    .update({ used_at: new Date().toISOString() })
    .eq('jti', challenge.jti)
    .is('used_at', null)
    .select('jti');
  if (!spent?.length) throw restartTwoFa(TWO_FA_USED_MESSAGE);

  resetLoginAttempts(employee.email);
  return completeTwoFaLogin(employee.id);
};

/**
 * Audit finding N-12 / #6: sign the employee out everywhere. Raises
 * employees.token_version so every access token already issued stops
 * passing auth.middleware.js at once, and deletes every refresh token so no
 * device can mint a new one.
 *
 * The raise is a compare-and-set on the database's own value (never a value
 * taken from a token), retried if another raise lands first, so the version
 * only ever goes up. Best-effort: a failure is logged and never blocks the
 * action that triggered it (logout/password change/deactivation itself
 * already succeeded by the time this runs).
 */
const bumpTokenVersion = async (employeeId) => {
  let bumped = false;
  for (let round = 0; round < 5 && !bumped; round += 1) {
    const { data: row, error: readError } = await supabaseAdmin
      .from('employees')
      .select('token_version')
      .eq('id', employeeId)
      .maybeSingle();
    if (readError || !row) {
      if (readError && !isMissingColumnError(readError.message, 'token_version')) {
        logger.warn('Failed to read token_version', { employeeId, error: readError.message });
      }
      break;
    }
    const current = row.token_version ?? 0;
    const { data: updated, error } = await supabaseAdmin
      .from('employees')
      .update({ token_version: current + 1 })
      .eq('id', employeeId)
      .eq('token_version', current)
      .select('id');
    if (error) {
      logger.warn('Failed to bump token_version', { employeeId, error: error.message });
      break;
    }
    bumped = Boolean(updated?.length);
  }
  await revokeRefreshTokens(employeeId);
  return bumped;
};

/**
 * A new session for the person who just changed their password. The change
 * signs out everywhere (token_version raised, refresh tokens deleted),
 * including the session they are using; without this the next request after
 * "Password updated" was a 401. Issued from the new version, so only this
 * session comes back — every other one stays signed out.
 */
const issueSessionFor = async (employeeId) => {
  const { data: employee, error } = await supabaseAdmin
    .from('employees')
    .select('*')
    .eq('id', employeeId)
    .eq('is_active', true)
    .maybeSingle();
  if (error || !employee) throw new NotFoundError('Employee not found');
  const tokens = generateTokens(employee);
  await storeRefreshToken(employee.id, tokens.refreshToken);
  return tokens;
};

/**
 * token_version is per employee, so signing out ends every session they have
 * (access and refresh tokens), not just this browser's.
 */
const logout = async (employeeId) => {
  await bumpTokenVersion(employeeId);
};

const changePassword = async (employeeId, currentPassword, newPassword) => {
  const { data: employee } = await supabaseAdmin
    .from('employees')
    .select('password_hash, must_change_password, company_id, address')
    .eq('id', employeeId)
    .single();

  if (!employee) throw new NotFoundError('Employee not found');

  const mustChange = Boolean(employee.must_change_password);
  if (!mustChange) {
    const valid = await comparePassword(currentPassword, employee.password_hash);
    if (!valid) throw new UnauthorizedError('Current password is incorrect');
  } else if (currentPassword) {
    const valid = await comparePassword(currentPassword, employee.password_hash);
    if (!valid) throw new UnauthorizedError('Current password is incorrect');
  }

  const companyId = getCompanyId(employee);
  await assertPasswordPolicy(newPassword, companyId);

  const passwordHash = await hashPassword(newPassword);
  {
    const { error: pwError } = await supabaseAdmin
      .from('employees')
      .update({ password_hash: passwordHash, must_change_password: false, temp_password_expires_at: null })
      .eq('id', employeeId);
    if (pwError && isMissingColumnError(pwError.message, 'temp_password_expires_at')) {
      await supabaseAdmin
        .from('employees')
        .update({ password_hash: passwordHash, must_change_password: false })
        .eq('id', employeeId);
    }
  }
  // Audit findings N-12 / #6: a changed password signs out every session —
  // access and refresh tokens. auth.controller.js then issues a fresh
  // session for the one that made the change.
  await bumpTokenVersion(employeeId);
};

// ── Resetting someone's two-step login (lost phone) ─────────────────────────

/** Which roles each role may reset. Nobody resets their own. */
const TWO_FA_RESETTABLE_ROLES = {
  admin: ['admin', 'hr', 'manager', 'employee'],
  hr: ['manager', 'employee'],
};

/** Throws unless `actor` may reset `target`'s two-step login. Both carry { id, role }. */
const assertCanResetTwoFactor = (actor, target) => {
  const allowed = TWO_FA_RESETTABLE_ROLES[actor?.role];
  if (!allowed) throw new ForbiddenError('Only an Admin or HR can reset two-step login.');
  if (sameId(actor.id, target?.id)) {
    throw new ForbiddenError("You can't reset your own two-step login. Ask another Admin to do it.");
  }
  if (!allowed.includes(target?.role)) {
    throw new ForbiddenError(actor.role === 'hr'
      ? 'HR can reset two-step login for employees and managers only. Ask an Admin.'
      : "You can't reset this person's two-step login.");
  }
};

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const displayName = (person) => `${person?.first_name || ''} ${person?.last_name || ''}`.trim();

const sendTwoFactorResetEmail = (target, actorName) => {
  const name = escapeHtml(target.first_name || 'there');
  const by = escapeHtml(actorName);
  return sendEmail({
    to: target.email,
    subject: 'Your two-step login was reset',
    type: 'two_step_login_reset',
    html: `<p>Hi ${name},</p>`
      + `<p>Your two-step login was reset by ${by}. You have been signed out on every device.</p>`
      + '<p>Next time you sign in you will only need your password. You can turn two-step login on again from Account security.</p>'
      + '<p>If you did not ask for this, contact your HR or Admin straight away.</p>',
  });
};

/**
 * Admin/HR turns off someone's two-step login (they lost their phone): the
 * secret is cleared, two-step login is turned off, and they are signed out
 * everywhere. Recorded in the audit log and emailed to them.
 * Scoped to the actor's company and its child companies, like every other
 * HR/Admin employee action.
 */
const resetEmployeeTwoFactor = async (actor, targetId, { ipAddress = null } = {}) => {
  if (!TWO_FA_RESETTABLE_ROLES[actor?.role]) throw new ForbiddenError('Only an Admin or HR can reset two-step login.');
  if (sameId(actor.id, targetId)) {
    throw new ForbiddenError("You can't reset your own two-step login. Ask another Admin to do it.");
  }
  const homeCompanyId = actor.company_id;
  if (!homeCompanyId) throw new ForbiddenError('Only an Admin or HR can reset two-step login.');
  const scopeIds = [...new Set((await tenantService.getOrgCompanyIds(homeCompanyId)).map(String))];

  const { data: target, error } = await supabaseAdmin
    .from('employees')
    .select('id, email, first_name, last_name, role, company_id, two_fa_enabled, totp_secret')
    .eq('id', String(targetId).toLowerCase())
    .in('company_id', scopeIds)
    .maybeSingle();
  if (error) throw new BadRequestError(error.message);
  if (!target) throw new NotFoundError('Employee not found');

  assertCanResetTwoFactor(actor, target);
  if (!target.two_fa_enabled && !target.totp_secret) {
    throw new BadRequestError("Two-step login isn't turned on for this person.");
  }

  const { error: updateError } = await supabaseAdmin
    .from('employees')
    .update({ two_fa_enabled: false, totp_secret: null, updated_at: new Date().toISOString() })
    .eq('id', target.id)
    .eq('company_id', target.company_id);
  if (updateError) throw new BadRequestError(updateError.message);

  await bumpTokenVersion(target.id);

  const actorName = displayName(actor) || 'your Admin';
  Promise.resolve().then(() => require('./auditLog.service').logAudit({
    companyId: actor.company_id,
    actorId: actor.id,
    actorRole: actor.role,
    actionType: 'employee.two_step_reset',
    targetType: 'employee',
    targetId: target.id,
    beforeState: { twoFaEnabled: Boolean(target.two_fa_enabled) },
    afterState: { twoFaEnabled: false, signedOutEverywhere: true },
    ipAddress,
  })).catch(() => {});

  // Never awaited, never fails the reset (it has already happened).
  if (target.email) {
    Promise.resolve()
      .then(() => sendTwoFactorResetEmail(target, actorName))
      .catch((err) => logger.error('Two-step reset email failed', { employeeId: target.id, error: err.message }));
  }

  return { employeeId: target.id, twoFaEnabled: false };
};

/**
 * Same email can now exist at multiple companies, so a bare email alone
 * doesn't always identify one account. `tenantCompanyId` (from a resolved
 * subdomain) disambiguates when present; without it, an ambiguous match is
 * treated the same as "unknown" rather than guessing which company's
 * account to touch.
 */
const findOneEmployeeByEmail = async (email, tenantCompanyId, selectCols = '*') => {
  let query = supabaseAdmin.from('employees').select(selectCols).eq('email', email);
  if (tenantCompanyId) query = query.eq('company_id', tenantCompanyId);
  const { data } = await query;
  return (data && data.length === 1) ? data[0] : null;
};

const forgotPassword = async (email, tenantCompanyId = null) => {
  const guard = assertNotOtpLocked(email, tenantCompanyId);
  const now = Date.now();

  if (guard.nextResendAt > now) {
    const retryAfterSeconds = Math.ceil((guard.nextResendAt - now) / 1000);
    throw new TooManyRequestsError(
      `Please wait ${waitLabel(retryAfterSeconds)} before requesting another code.`,
      {
        ...lockDetails(guard),
        nextResendAt: guard.nextResendAt,
        retryAfterSeconds,
        reason: 'resend_cooldown',
      },
    );
  }

  const employee = await findOneEmployeeByEmail(email, tenantCompanyId);

  // Always apply progressive resend cooldown (even if email unknown) to avoid enumeration timing
  const waitIdx = Math.min(guard.resendCount, OTP_WAIT_SECONDS.length - 1);
  guard.resendCount += 1;
  guard.nextResendAt = now + OTP_WAIT_SECONDS[waitIdx] * 1000;
  // Reset wrong-OTP streak when a new code is issued
  guard.failedAttempts = 0;

  if (!employee) {
    return {
      message: 'If the email exists, an OTP has been sent',
      nextResendAt: guard.nextResendAt,
      retryAfterSeconds: OTP_WAIT_SECONDS[waitIdx],
      attemptsRemaining: OTP_MAX_ATTEMPTS,
    };
  }

  // Generate 6-digit OTP and store hashed OTP in DB
  const otp = String(crypto.randomInt(100000, 1000000));
  const tokenHash = crypto.createHash('sha256').update(otp).digest('hex');

  // Invalidate any previous active tokens for this user
  await supabaseAdmin
    .from('password_reset_tokens')
    .update({ used: true })
    .eq('employee_id', employee.id)
    .eq('used', false);

  await supabaseAdmin.from('password_reset_tokens').insert({
    employee_id: employee.id,
    token_hash: tokenHash,
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(), // 10 minutes
  });

  passwordResetEmail(employee, otp).catch((err) => {
    logger.error('Password reset email failed', { error: err.message });
  });
  return {
    message: 'If the email exists, an OTP has been sent',
    nextResendAt: guard.nextResendAt,
    retryAfterSeconds: OTP_WAIT_SECONDS[waitIdx],
    attemptsRemaining: OTP_MAX_ATTEMPTS,
  };
};

const resetPassword = async (email, otp, newPassword, tenantCompanyId = null) => {
  const guard = assertNotOtpLocked(email, tenantCompanyId);

  let candidateQuery = supabaseAdmin.from('employees').select('id, company_id, address').eq('email', email);
  if (tenantCompanyId) candidateQuery = candidateQuery.eq('company_id', tenantCompanyId);
  const { data: candidates } = await candidateQuery;
  const candidateIds = (candidates || []).map((e) => e.id);

  if (!candidateIds.length) {
    // Count as a failed attempt even for unknown emails (same UX)
    guard.failedAttempts += 1;
    if (guard.failedAttempts >= OTP_MAX_ATTEMPTS) {
      const waitIdx = Math.min(guard.lockLevel, OTP_WAIT_SECONDS.length - 1);
      const waitSec = OTP_WAIT_SECONDS[waitIdx];
      guard.lockLevel += 1;
      guard.failedAttempts = 0;
      guard.lockedUntil = Date.now() + waitSec * 1000;
      throw new TooManyRequestsError(
        `Too many wrong OTPs. Try again in ${waitLabel(waitSec)}.`,
        lockDetails(guard, { retryAfterSeconds: waitSec, reason: 'otp_lockout' }),
      );
    }
    throw new BadRequestError('Invalid or expired OTP', {
      attemptsRemaining: OTP_MAX_ATTEMPTS - guard.failedAttempts,
    });
  }

  const tokenHash = crypto.createHash('sha256').update(String(otp)).digest('hex');
  const { data: resetRecord } = await supabaseAdmin
    .from('password_reset_tokens')
    .select('*')
    .eq('token_hash', tokenHash)
    .in('employee_id', candidateIds)
    .eq('used', false)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();

  if (!resetRecord) {
    guard.failedAttempts += 1;
    if (guard.failedAttempts >= OTP_MAX_ATTEMPTS) {
      const waitIdx = Math.min(guard.lockLevel, OTP_WAIT_SECONDS.length - 1);
      const waitSec = OTP_WAIT_SECONDS[waitIdx];
      guard.lockLevel += 1;
      guard.failedAttempts = 0;
      guard.lockedUntil = Date.now() + waitSec * 1000;
      throw new TooManyRequestsError(
        `Too many wrong OTPs. Try again in ${waitLabel(waitSec)}.`,
        lockDetails(guard, { retryAfterSeconds: waitSec, reason: 'otp_lockout' }),
      );
    }
    throw new BadRequestError(
      `Invalid or expired OTP. ${OTP_MAX_ATTEMPTS - guard.failedAttempts} attempt(s) left.`,
      { attemptsRemaining: OTP_MAX_ATTEMPTS - guard.failedAttempts },
    );
  }

  const employee = candidates.find((e) => e.id === resetRecord.employee_id);
  const companyId = getCompanyId(employee);
  await assertPasswordPolicy(newPassword, companyId);

  // Audit finding N-21: claim the OTP (used:false -> true, conditionally)
  // BEFORE writing the new password, not after — the earlier SELECT above
  // only narrowed the race window, it didn't close it. Two concurrent
  // resetPassword calls with the same valid OTP could otherwise both pass
  // that read and both reach the password write. Whichever request's
  // conditional UPDATE actually flips zero rows lost the race and must not
  // touch the password at all.
  const { data: claimed, error: claimErr } = await supabaseAdmin
    .from('password_reset_tokens')
    .update({ used: true })
    .eq('id', resetRecord.id)
    .eq('used', false)
    .select('id')
    .maybeSingle();
  if (claimErr) throw new BadRequestError(claimErr.message);
  if (!claimed) {
    throw new BadRequestError('Invalid or expired OTP', {
      attemptsRemaining: OTP_MAX_ATTEMPTS - guard.failedAttempts,
    });
  }

  const passwordHash = await hashPassword(newPassword);
  await supabaseAdmin
    .from('employees')
    .update({ password_hash: passwordHash, must_change_password: false })
    .eq('id', resetRecord.employee_id);
  // Audit findings N-12 / #6: OTP-based reset is still a password change — a
  // stolen access or refresh token shouldn't survive the legitimate user
  // resetting it. Signs out everywhere.
  await bumpTokenVersion(resetRecord.employee_id);

  clearOtpGuard(email, tenantCompanyId);
};

const getMe = async (employeeId) => {
  const { data: employee, error } = await supabaseAdmin
    .from('employees')
    .select('*, manager:manager_id(id, first_name, last_name, email)')
    .eq('id', employeeId)
    .single();

  if (error || !employee) throw new NotFoundError('Employee not found');

  let profilePictureUrl = null;
  if (employee.profile_picture) {
    try {
      profilePictureUrl = await getSignedUrl(STORAGE_BUCKETS.profilePictures, employee.profile_picture, 86400);
    } catch {
      /* missing file — topbar falls back to initials */
    }
  }
  return {
    ...omitSensitive(employee, ['password_hash']),
    profile_picture_url: profilePictureUrl,
    company_id: getCompanyId(employee),
  };
};

/** True when the has_seen_install_prompt migration hasn't been applied yet in this environment. */
const isMissingInstallPromptColumn = (message) => isMissingColumnError(message, 'has_seen_install_prompt');

/**
 * Item 4: server-side "seen" flag for the PWA install prompt, set once on
 * dismiss/install/guide-viewed so it doesn't nag every session and doesn't
 * reset on a browser data clear (a sessionStorage/localStorage flag would).
 */
const markInstallPromptSeen = async (employeeId) => {
  const { error } = await supabaseAdmin
    .from('employees')
    .update({ has_seen_install_prompt: true })
    .eq('id', employeeId);
  if (error && !isMissingInstallPromptColumn(error.message)) throw error;
};

/** In-memory onboarding email OTP store: email -> { hash, expiresAt, failedAttempts, nextResendAt, verifiedToken, verifiedUntil } */
const onboardingOtps = new Map();

/**
 * Scoped by invite id, not bare email — a brand new company has no
 * company_id yet to scope by, but every onboarding attempt is already tied
 * to one specific invite. Without this, two unrelated people onboarding two
 * different new companies who happen to share an email would share one
 * OTP lockout/cooldown state and could interfere with each other's attempts.
 */
const onboardingOtpKey = (email, inviteId) => `${inviteId || 'unscoped'}:${normalizeEmailKey(email)}`;

const sendOnboardingOtp = async (email, adminName = '', inviteToken = null) => {
  const superAdminService = require('./superAdmin.service');
  const invite = await superAdminService.assertInviteValid(inviteToken);

  const emailKey = normalizeEmailKey(email);
  if (!emailKey) throw new BadRequestError('Valid email is required');
  if (invite.email && invite.email !== emailKey) {
    throw new ForbiddenError('This invite is locked to a different email address');
  }
  const key = onboardingOtpKey(email, invite.inviteId);

  // Deliberately no "does this email already exist" check here — this flow
  // creates a BRAND NEW company, and the same person's email may already be
  // an account at a different, unrelated company. That's allowed by design;
  // uniqueness is enforced per-company at the database level, not globally.

  const entry = onboardingOtps.get(key) || {
    hash: null,
    expiresAt: 0,
    failedAttempts: 0,
    nextResendAt: 0,
    verifiedToken: null,
    verifiedUntil: 0,
  };

  const now = Date.now();
  if (entry.nextResendAt > now) {
    const retryAfterSeconds = Math.ceil((entry.nextResendAt - now) / 1000);
    throw new TooManyRequestsError(
      `Please wait ${waitLabel(retryAfterSeconds)} before requesting another code.`,
      { retryAfterSeconds, nextResendAt: entry.nextResendAt, reason: 'resend_cooldown' },
    );
  }

  const otp = String(crypto.randomInt(100000, 1000000));
  const tokenHash = crypto.createHash('sha256').update(otp).digest('hex');
  entry.hash = tokenHash;
  entry.expiresAt = now + 10 * 60 * 1000;
  entry.failedAttempts = 0;
  entry.verifiedToken = null;
  entry.verifiedUntil = 0;
  entry.nextResendAt = now + 30 * 1000;
  onboardingOtps.set(key, entry);

  // Do not block the HTTP response on SMTP — Render + Gmail often exceeds 30s.
  onboardingOtpEmail(email, adminName, otp).catch((err) => {
    logger.error('Onboarding OTP email failed', { error: err.message });
  });

  return {
    message: 'OTP sent to your email',
    nextResendAt: entry.nextResendAt,
    retryAfterSeconds: 30,
    expiresInSeconds: 600,
  };
};

const verifyOnboardingOtp = async (email, otp, inviteToken = null) => {
  const superAdminService = require('./superAdmin.service');
  const invite = await superAdminService.assertInviteValid(inviteToken);
  const key = onboardingOtpKey(email, invite.inviteId);
  const entry = onboardingOtps.get(key);
  if (!entry?.hash) throw new BadRequestError('Request an OTP first');

  const now = Date.now();
  if (entry.expiresAt <= now) {
    throw new BadRequestError('OTP expired. Request a new code.');
  }

  if (entry.failedAttempts >= OTP_MAX_ATTEMPTS) {
    throw new TooManyRequestsError(
      'Too many wrong OTPs. Request a new code.',
      { attemptsRemaining: 0, reason: 'otp_lockout' },
    );
  }

  const tokenHash = crypto.createHash('sha256').update(String(otp)).digest('hex');
  if (tokenHash !== entry.hash) {
    entry.failedAttempts += 1;
    onboardingOtps.set(key, entry);
    const left = OTP_MAX_ATTEMPTS - entry.failedAttempts;
    if (left <= 0) {
      throw new TooManyRequestsError(
        'Too many wrong OTPs. Request a new code.',
        { attemptsRemaining: 0, reason: 'otp_lockout' },
      );
    }
    throw new BadRequestError(`Invalid OTP. ${left} attempt(s) left.`, {
      attemptsRemaining: left,
    });
  }

  const verificationToken = crypto.randomBytes(32).toString('hex');
  entry.verifiedToken = crypto.createHash('sha256').update(verificationToken).digest('hex');
  entry.verifiedUntil = now + 15 * 60 * 1000;
  entry.hash = null;
  entry.failedAttempts = 0;
  onboardingOtps.set(key, entry);

  return {
    message: 'Email verified',
    verificationToken,
    expiresInSeconds: 900,
  };
};

const assertOnboardingEmailVerified = (email, verificationToken, inviteId) => {
  const key = onboardingOtpKey(email, inviteId);
  const entry = onboardingOtps.get(key);
  if (!entry?.verifiedToken || !verificationToken) {
    throw new BadRequestError('Verify your email with OTP before launching');
  }
  if (entry.verifiedUntil <= Date.now()) {
    // Expired token — clear so a new OTP is required
    entry.verifiedToken = null;
    entry.verifiedUntil = 0;
    onboardingOtps.set(key, entry);
    throw new BadRequestError('Email verification expired. Request a new OTP.');
  }
  const hash = crypto.createHash('sha256').update(String(verificationToken)).digest('hex');
  if (hash !== entry.verifiedToken) {
    throw new BadRequestError('Invalid email verification. Request a new OTP.');
  }
  // One-time use: nullify the verification token immediately after use so
  // a captured or replayed token can't be re-submitted.
  entry.verifiedToken = null;
  entry.verifiedUntil = 0;
  onboardingOtps.set(key, entry);
};

const consumeOnboardingVerification = (email, inviteId) => {
  onboardingOtps.delete(onboardingOtpKey(email, inviteId));
};

/**
 * Item 3: auto-create a 'trialing' subscription on the lowest/default plan
 * (Starter) at onboarding time, reusing subscription.service.js's
 * createSubscription rather than a second insert path — same validation,
 * event logging, and welcome-notification behavior every other
 * subscription creation gets, just with initialStatus='trialing' (no
 * invoice — a trial hasn't been charged) and triggeredBy='system' (no
 * human actor initiated this).
 */
const bootstrapTrialSubscription = async (companyId) => {
  const { data: defaultPlan, error } = await supabaseAdmin
    .from('subscription_plans')
    .select('id, code, included_seats')
    .eq('code', 'starter')
    .eq('is_active', true)
    .maybeSingle();
  if (error) throw new BadRequestError(`Could not look up the default plan: ${error.message}`);
  if (!defaultPlan) {
    logger.error('[Onboarding] No active "starter" plan found — cannot create trial subscription', { companyId });
    throw new BadRequestError('No default plan is configured for new signups. Contact support.');
  }

  const subscriptionService = require('./subscription.service');
  await subscriptionService.createSubscription(
    companyId,
    defaultPlan.id,
    'monthly',
    Math.max(1, defaultPlan.included_seats || 5),
    null,
    null,
    'trialing',
    'system',
  );
};

/**
 * Onboarding: create a NEW isolated company workspace + its first admin.
 * Existing demo/legacy employees stay under the default company and are NOT visible here.
 */
const bootstrapAdmin = async ({
  email,
  password,
  first_name,
  last_name,
  company_profile = null,
  verificationToken = null,
  inviteToken = null,
  logoFile = null,
  workspaceSlug = null,
}) => {
  if (!email) throw new BadRequestError('email is required');
  if (!first_name) throw new BadRequestError('first_name is required');

  const superAdminService = require('./superAdmin.service');
  const invite = await superAdminService.assertInviteValid(inviteToken);
  const normalizedEmail = String(email).toLowerCase().trim();
  if (invite.email && invite.email !== normalizedEmail) {
    throw new ForbiddenError('This invite is locked to a different email address');
  }
  const submittedCompanyName = String(company_profile?.name || '').trim();
  if (submittedCompanyName !== invite.companyNameHint) {
    throw new ForbiddenError('The company name must match the onboarding invitation');
  }

  // The person onboarding may edit the subdomain the invite suggested.
  // Re-checked here at submit time (not only by the live availability
  // check in the UI) so two onboardings can't both claim the same slug.
  let companySlug = invite.companySlug;
  if (workspaceSlug && String(workspaceSlug).trim().toLowerCase() !== invite.companySlug) {
    const { slug: requested, status } = await checkSlugAvailability(workspaceSlug, { excludeInviteId: invite.inviteId });
    if (status === 'taken') throw new ConflictError('That workspace address is already taken. Choose another.');
    if (status !== 'available') {
      throw new BadRequestError('That workspace address is not available — use lowercase letters, numbers, and hyphens only.');
    }
    companySlug = requested;
  }

  assertOnboardingEmailVerified(email, verificationToken, invite.inviteId);

  const last = last_name || 'Admin';
  const resolvedPassword = password || generateDefaultPassword();
  await assertPasswordPolicy(resolvedPassword);
  const passwordHash = await hashPassword(resolvedPassword);

  // No global "does this email exist" check here — this creates a BRAND NEW
  // company, and the same email legitimately existing at a different,
  // unrelated company must not block it. The database enforces uniqueness
  // per company, and this is always a fresh company_id, so no collision is
  // possible within it regardless of what exists elsewhere on the platform.

  const companyId = newCompanyId();
  const companyName = invite.companyNameHint;
  await tenantService.ensureCompanyRow({
    id: companyId,
    name: companyName,
    slug: companySlug,
  });

  const profile = {
    ...(company_profile && typeof company_profile === 'object' ? company_profile : {}),
    name: companyName,
  };

  if (logoFile) {
    const ext = String(logoFile.originalname || '').split('.').pop().toLowerCase();
    if (!['png', 'jpg', 'jpeg'].includes(ext)) {
      throw new BadRequestError('Logo must be PNG or JPG');
    }
    if (logoFile.size > 2 * 1024 * 1024) {
      throw new BadRequestError('Logo must be 2MB or smaller');
    }
    const { path } = await uploadCompanyLogo(logoFile, companyId);
    profile.logoPath = path;
    profile.logoName = logoFile.originalname;
  }

  const bootstrapFields = {
    employee_code: await allocateNextEmployeeCode(companyId),
    email: normalizedEmail,
    password_hash: passwordHash,
    first_name,
    last_name: last,
    role: 'admin',
    department: 'Administration',
    designation: 'Company Admin',
    date_of_joining: new Date().toISOString().split('T')[0],
    employment_type: 'full_time',
    is_active: true,
    must_change_password: !password,
    // Only a system-generated password is time-boxed — one the admin typed
    // in themselves during onboarding isn't a "temporary" credential at all.
    ...(!password ? { temp_password_expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString() } : {}),
    ...companyIdFields(companyId, {}),
  };
  let { data, error } = await supabaseAdmin.from('employees').insert(bootstrapFields).select().single();
  if (error && isMissingColumnError(error.message, 'temp_password_expires_at')) {
    const { temp_password_expires_at, ...withoutExpiry } = bootstrapFields;
    ({ data, error } = await supabaseAdmin.from('employees').insert(withoutExpiry).select().single());
  }
  if (error) throw new BadRequestError(error.message);

  await settingsService.seedCompanySettings(companyId, {
    ...profile,
    adminName: profile.adminName || `${first_name} ${last}`.trim(),
    adminEmail: profile.adminEmail || normalizedEmail,
  }, data.id);

  // Item 3: without this, a freshly onboarded company has ZERO subscription
  // rows — combined with item 4's fail-closed login rule ("no subscription
  // row = blocked"), that would lock every brand-new signup out immediately.
  // Not best-effort/fire-and-forget like the welcome email below — a
  // failure here must fail onboarding itself, since a company silently left
  // without a trial would be unable to log in at all.
  await bootstrapTrialSubscription(companyId);

  await superAdminService.consumeInvite(inviteToken, companyId);
  consumeOnboardingVerification(normalizedEmail, invite.inviteId);

  welcomeEmail(data, resolvedPassword).catch((e) => logger.warn('Welcome email failed', e.message));

  let logoUrl = null;
  if (profile.logoPath) {
    try {
      logoUrl = await getSignedUrl(STORAGE_BUCKETS.documents, profile.logoPath, 86400);
    } catch (err) {
      logger.warn('Onboarding logo URL failed', err.message);
    }
  }

  logger.info('Onboarding company + admin created', {
    id: data.id, email: data.email, companyId, inviteId: invite.inviteId,
  });

  return {
    ...omitSensitive(data, ['password_hash']),
    company_id: companyId,
    company_slug: companySlug,
    logoPath: profile.logoPath || null,
    logoName: profile.logoName || null,
    logoUrl,
    // Credentials are emailed — never include plaintext password in the API response.
  };
};

module.exports = {
  login,
  loginToPortal,
  completeTwoFaLogin,
  verifyTwoFaLogin,
  resetEmployeeTwoFactor,
  assertCanResetTwoFactor,
  refreshAccessToken,
  logout,
  changePassword,
  forgotPassword,
  resetPassword,
  getMe,
  hashPassword,
  assertPasswordPolicy,
  generateOnboardingToken,
  sendOnboardingOtp,
  verifyOnboardingOtp,
  bootstrapAdmin,
  bootstrapTrialSubscription,
  bumpTokenVersion,
  issueSessionFor,
  markInstallPromptSeen,
};
