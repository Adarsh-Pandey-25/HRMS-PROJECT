const jwt = require('jsonwebtoken');
const { supabaseAdmin } = require('../config/supabase');
const { UnauthorizedError, ForbiddenError } = require('../utils/errors');
const { getCompanyId } = require('../utils/tenant');
const { omitSensitive } = require('../utils/helpers');
const {
  extractApiKey,
  attachApiKeyUser,
} = require('./apiKey.middleware');
const apiKeyService = require('../services/apiKey.service');

const EMPLOYEE_SELECT_COLUMNS = 'id, employee_code, first_name, last_name, email, role, department, designation, manager_id, is_active, company_id, address, date_of_joining, phone, profile_picture';

/**
 * Audit finding N-12: fetches the employee including token_version so the
 * caller can reject a token whose version no longer matches (bumped on
 * logout/password change/deactivation — see auth.service.js's
 * bumpTokenVersion). Falls back to the old column list if the migration
 * (20260830_employee_token_version.sql) hasn't run yet in this
 * environment, so auth doesn't hard-break on a missing column.
 */
const fetchEmployeeForAuth = async (id) => {
  const { data, error } = await supabaseAdmin
    .from('employees')
    .select(`${EMPLOYEE_SELECT_COLUMNS}, token_version`)
    .eq('id', id)
    .eq('is_active', true)
    .single();

  if (error && /column .*token_version.* does not exist/i.test(error.message || '')) {
    const fallback = await supabaseAdmin
      .from('employees')
      .select(EMPLOYEE_SELECT_COLUMNS)
      .eq('id', id)
      .eq('is_active', true)
      .single();
    return { data: fallback.data, error: fallback.error, tokenVersionAvailable: false };
  }
  return { data, error, tokenVersionAvailable: true };
};

/**
 * Subscription billing: a suspended company's non-super-admin users are
 * blocked from authenticating at all, same layer as the is_active/
 * token_version checks above rather than a parallel check elsewhere. Data
 * is never touched — this is purely an access gate. No subscription row at
 * all (company never subscribed, or this is a dev/test environment) is not
 * suspended, so it never blocks.
 */
const isCompanySuspended = async (companyId) => {
  if (!companyId) return false;
  const { data } = await supabaseAdmin
    .from('company_billing_subscriptions')
    .select('id')
    .eq('company_id', companyId)
    .eq('status', 'suspended')
    .limit(1)
    .maybeSingle();
  return Boolean(data);
};

const attachTenant = (employee) => {
  if (!employee) return employee;
  const safe = omitSensitive(employee, [
    'password_hash',
    'passwordHash',
    'password',
    'temp_password',
    'tempPassword',
  ]);
  safe.company_id = getCompanyId(employee);
  return safe;
};

const authenticate = async (req, res, next) => {
  try {
    // 1) Company API key (integrations / biometric devices)
    const rawApiKey = extractApiKey(req);
    if (rawApiKey) {
      const keyRow = await apiKeyService.verifyApiKey(rawApiKey);
      if (!keyRow) {
        throw new UnauthorizedError('Invalid or revoked API key');
      }
      attachApiKeyUser(req, keyRow);
      return next();
    }

    // 2) User JWT (cookie or Bearer)
    const token =
      req.cookies?.accessToken ||
      (req.headers.authorization?.startsWith('Bearer ')
        ? req.headers.authorization.split(' ')[1]
        : null);

    if (!token) {
      throw new UnauthorizedError('Access token or API key required');
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const { data: employee, error, tokenVersionAvailable } = await fetchEmployeeForAuth(decoded.id);

    if (error || !employee) {
      throw new UnauthorizedError('Invalid or expired token');
    }

    // Audit finding N-12: ?? 0 on both sides — a token issued before this
    // column existed carries no token_version claim, and employees.token_version
    // defaults to 0, so pre-existing sessions aren't mass-invalidated the
    // moment this deploys. Only a genuine logout/password-change/
    // deactivation after that point actually diverges the two values.
    if (tokenVersionAvailable && (decoded.token_version ?? 0) !== (employee.token_version ?? 0)) {
      throw new UnauthorizedError('Session has been revoked. Please log in again.');
    }

    if (await isCompanySuspended(employee.company_id)) {
      throw new ForbiddenError('Your company\'s subscription is suspended. Please contact billing.');
    }

    req.user = attachTenant(employee);
    req.token = token;
    req.authType = 'jwt';

    // Module 4: an impersonation token is a normal employee JWT plus this
    // claim, same signature/expiry enforcement as any other token — but
    // its hard TTL (45 min) is what "expires" it, NOT the super-admin
    // clicking "End Impersonation". endImpersonation() only ever marked
    // impersonation_sessions.ended_at in the DB; it never bumped the
    // impersonated employee's token_version (correctly — that would also
    // kill that employee's own unrelated real sessions) and never revoked
    // the JWT itself, so the token stayed fully valid until its natural
    // expiry regardless of "ending" it. That let an already-issued
    // impersonation cookie silently keep authenticating requests after the
    // UI claimed the session was over — e.g. a login page visited afterward
    // in the same browser would see isAuthenticated: true from this dead
    // session and skip straight to that dashboard instead of showing a
    // fresh login form (the confirmed "wrong panel after login" bug).
    // Checked here, once per request, only for impersonation-typed tokens.
    if (decoded.typ === 'impersonation') {
      const { data: session } = await supabaseAdmin
        .from('impersonation_sessions')
        .select('id, ended_at, expires_at')
        .eq('id', decoded.sessionId)
        .maybeSingle();
      const stillLive = session && !session.ended_at && new Date(session.expires_at) > new Date();
      if (!stillLive) {
        throw new UnauthorizedError('Impersonation session has ended');
      }
      req.impersonation = {
        isImpersonating: true,
        superAdminId: decoded.superAdminId,
        superAdminEmail: decoded.superAdminEmail,
        sessionId: decoded.sessionId,
        companyName: decoded.companyName,
        expiresAt: decoded.exp ? new Date(decoded.exp * 1000).toISOString() : null,
      };
    }

    next();
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return next(new UnauthorizedError('Invalid or expired token'));
    }
    next(err);
  }
};

const optionalAuth = async (req, res, next) => {
  try {
    const token =
      req.cookies?.accessToken ||
      (req.headers.authorization?.startsWith('Bearer ')
        ? req.headers.authorization.split(' ')[1]
        : null);

    if (!token) return next();

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const { data: employee, tokenVersionAvailable } = await fetchEmployeeForAuth(decoded.id);

    if (
      employee
      && (!tokenVersionAvailable || (decoded.token_version ?? 0) === (employee.token_version ?? 0))
      && !(await isCompanySuspended(employee.company_id))
    ) {
      req.user = attachTenant(employee);
    }
    next();
  } catch {
    next();
  }
};

module.exports = { authenticate, optionalAuth };
