const { supabaseAdmin } = require('../config/supabase');
const authService = require('../services/auth.service');
const { successResponse, paginate, buildMeta, omitSensitive, generateDefaultPassword, isMissingColumnError } = require('../utils/helpers');
const { BadRequestError, NotFoundError, ConflictError, ForbiddenError } = require('../utils/errors');
const { getCompanyId, withCompanyId, companyIdFields } = require('../utils/tenant');
const { isUuid, normalizeId, sameId } = require('../utils/sameId');
const { auditFromRequest, logAudit } = require('../services/auditLog.service');
const {
  employeeBelongsToCompany,
  getOrgCompanyIds,
  isCompanyInOrg,
  getCompanyById,
} = require('../services/tenant.service');
const { allocateNextEmployeeCode } = require('../services/employeeCode.service');
const { uploadProfilePicture, getSignedUrl, getSignedUrls, STORAGE_BUCKETS, deleteEmployeeFolder } = require('../services/storage.service');
const logger = require('../utils/logger');
const profileCompletion = require('../services/profileCompletion.service');
const { runInBackground } = require('../utils/background');

/** Employee fields that auto-log a career event when HR/Admin changes them via update(). */
const CAREER_TRACKED_FIELDS = {
  designation: 'designation_change',
  department: 'department_change',
  manager_id: 'manager_change',
  salary_details: 'salary_change',
  bank_details: 'bank_change',
};

/** JSONB object fields need the canonical (key-order-insensitive) comparison
 *  below, not the plain scalar trim comparison used for the rest. */
const JSON_CAREER_FIELDS = new Set(['salary_details', 'bank_details']);

const stringifyCareerValue = (val) => {
  if (val === null || val === undefined || val === '') return null;
  return typeof val === 'object' ? JSON.stringify(val) : String(val);
};

/** Recursively sorts object keys so structurally-identical objects compare equal
 *  regardless of key insertion order — Postgres JSONB doesn't preserve it, so a
 *  raw JSON.stringify diff was firing a spurious "salary updated" event on
 *  nearly every save even when nothing actually changed. */
const canonicalize = (val) => {
  if (val === null || val === undefined) return null;
  if (Array.isArray(val)) return val.map(canonicalize);
  if (typeof val === 'object') {
    return Object.keys(val).sort().reduce((acc, k) => {
      acc[k] = canonicalize(val[k]);
      return acc;
    }, {});
  }
  return val;
};
const canonicalStringify = (val) => JSON.stringify(canonicalize(val));

/**
 * Compare `before` (row prior to update) against `after` (fields actually sent in this
 * update) for exactly the four tracked fields, and insert one employee_career_events row
 * per field that actually changed. Best-effort — a logging failure must never fail the
 * employee update itself.
 */
async function logCareerEvents({ employeeId, companyId, before, after, actorId }) {
  const events = [];
  for (const [field, eventType] of Object.entries(CAREER_TRACKED_FIELDS)) {
    if (!(field in after)) continue; // field wasn't part of this update payload
    const fromVal = before ? before[field] : undefined;
    const toVal = after[field];
    // Scalars are trimmed before comparing — a whitespace-only edit (e.g. a
    // stray trailing space added/removed from a designation) isn't a real
    // change and shouldn't get a permanent audit-trail entry.
    const changed = JSON_CAREER_FIELDS.has(field)
      ? canonicalStringify(fromVal || {}) !== canonicalStringify(toVal || {})
      : String(fromVal ?? '').trim() !== String(toVal ?? '').trim();
    if (!changed) continue;
    events.push({
      employee_id: employeeId,
      company_id: companyId,
      event_type: eventType,
      from_value: stringifyCareerValue(fromVal),
      to_value: stringifyCareerValue(toVal),
      effective_date: new Date().toISOString().slice(0, 10),
      created_by: actorId || null,
    });
  }
  if (!events.length) return;
  const { error } = await supabaseAdmin.from('employee_career_events').insert(events);
  if (error) {
    // Non-fatal: the employee record already updated successfully.
    // eslint-disable-next-line no-console
    console.error('Failed to log career events:', error.message);
  }
}

const EMPLOYEE_WRITE_FIELDS = [
  'first_name', 'last_name', 'phone', 'role', 'department', 'designation',
  'manager_id', 'date_of_joining', 'employment_type', 'gender', 'date_of_birth',
  'blood_group', 'marital_status', 'nationality', 'address', 'emergency_contact',
  'bank_details', 'salary_details', 'is_active', 'profile_picture',
];

const pickEmployeeFields = (body = {}, { includeRole = true } = {}) => {
  const out = {};
  for (const key of EMPLOYEE_WRITE_FIELDS) {
    if (body[key] === undefined) continue;
    if (key === 'role' && !includeRole) continue;
    out[key] = body[key];
  }
  return out;
};

const ALL_ROLES = ['admin', 'hr', 'manager', 'employee'];
/** Roles only an Admin may give or take away (audit #7, #41). */
const PRIVILEGED_ROLES = ['admin', 'hr'];

/** The role as sent, lower-cased; undefined when nothing (or a blank) was sent. */
const sentRole = (value) => {
  if (value === undefined || value === null || String(value).trim() === '') return undefined;
  return String(value).trim().toLowerCase();
};

/** true/false (or 'true'/'false'); undefined when not sent. */
const sentBoolean = (value, field) => {
  if (value === undefined) return undefined;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw new BadRequestError(`${field} must be true or false`);
};

const digitsOnly = (value) => String(value ?? '').replace(/\D/g, '');

/**
 * Write a refusal to the audit log and return the error for the caller to
 * throw, so every "no" about someone's account leaves a trail.
 */
function refusal(req, { target = null, companyId = null, action, attempted = {}, message, ErrorType = ForbiddenError }) {
  logAudit({
    companyId: companyId || (target ? getCompanyId(target) : (req.user.company_id || getCompanyId(req.user))),
    actorId: req.user.id,
    actorRole: req.user.role,
    actionType: 'employee.refused',
    targetType: 'employee',
    targetId: target?.id || null,
    beforeState: target ? { role: target.role, isActive: target.is_active } : null,
    afterState: { action, ...attempted, reason: message },
    ipAddress: req.ip,
  }).catch((e) => logger.warn('Audit log failed', { error: e.message }));
  return new ErrorType(message);
}

/**
 * Audit #9: Settings → User & Role Management guards acting on someone
 * else's record. Checked in the controller because these routes also accept
 * employee codes. The Admin always passes; your own record is never blocked.
 */
async function assertEmployeesPermission(req, action, target) {
  if (req.user.role === 'admin') return;
  if (await require('../services/rolePermissions.service').can(req.user, 'employees', action)) return;
  throw refusal(req, {
    target,
    action: `employees.${action}`,
    message: action === 'view'
      ? 'You don\'t have permission to view employees. Ask an Admin.'
      : 'You don\'t have permission to edit employees. Ask an Admin.',
  });
}

/** Active Admins of one company — the last one is never removed. */
async function countActiveAdmins(companyId) {
  const { count, error } = await supabaseAdmin
    .from('employees')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .eq('role', 'admin')
    .eq('is_active', true);
  if (error) throw new BadRequestError(error.message);
  return count || 0;
}

const SELF_REMOVAL_MESSAGES = {
  update: 'You can\'t deactivate your own account.',
  deactivate: 'You can\'t deactivate your own account.',
  offboard: 'You can\'t offboard yourself.',
  erase: 'You can\'t erase your own account.',
};

/**
 * Who may change whose account (audit #4, #7, #41):
 * - Nobody changes their own role, removes their own access or moves
 *   themselves to another company.
 * - Only an Admin changes anything on an Admin's account.
 * - Only an Admin changes another HR user's role, access (deactivate,
 *   reactivate, offboard, erase), mobile number or company. HR may still
 *   edit the rest of another HR user's profile, as before.
 * - Only an Admin gives or takes away the HR or Admin role.
 * - The company's last active Admin can't be demoted, deactivated,
 *   offboarded or erased.
 *
 * `change`: newRole (only when it differs from the current role),
 * removesAccess, restoresAccess, changesPhone, changesCompany.
 * Throws a logged refusal; returns nothing when allowed.
 */
async function assertMayChangeAccount(req, target, change = {}) {
  const {
    action, newRole, removesAccess = false, restoresAccess = false, changesPhone = false, changesCompany = false,
  } = change;
  const actorIsAdmin = req.user.role === 'admin';
  const isSelf = sameId(req.user.id, target.id);
  const roleChanging = newRole !== undefined;
  const attempted = {
    ...(roleChanging ? { fromRole: target.role, toRole: newRole } : {}),
    ...(removesAccess ? { removesAccess: true } : {}),
    ...(restoresAccess ? { restoresAccess: true } : {}),
    ...(changesPhone ? { changesPhone: true } : {}),
    ...(changesCompany ? { changesCompany: true } : {}),
  };
  const no = (message, ErrorType) => refusal(req, { target, action, attempted, message, ErrorType });

  if (isSelf) {
    if (roleChanging) throw no('You can\'t change your own role. Ask an Admin.');
    if (removesAccess) throw no(SELF_REMOVAL_MESSAGES[action] || 'You can\'t remove your own access.');
    if (changesCompany) throw no('You can\'t move yourself to another company. Ask an Admin.');
  } else if (!PRIVILEGED_ROLES.includes(req.user.role)) {
    throw no('Only HR or an Admin can change someone else\'s account.');
  }

  if (!actorIsAdmin) {
    if (target.role === 'admin') throw no('Only an Admin can change another Admin\'s account.');
    if (target.role === 'hr' && !isSelf
      && (roleChanging || removesAccess || restoresAccess || changesPhone || changesCompany)) {
      throw no('Only an Admin can change another HR user\'s role, access, mobile number or company.');
    }
    if (roleChanging && PRIVILEGED_ROLES.includes(newRole)) {
      throw no('Only an Admin can give someone the HR or Admin role.');
    }
  }

  const removesAnAdmin = target.role === 'admin' && target.is_active !== false
    && ((roleChanging && newRole !== 'admin') || removesAccess);
  if (removesAnAdmin && await countActiveAdmins(getCompanyId(target)) <= 1) {
    throw no('This is the company\'s last active Admin. Make someone else an Admin first.', ConflictError);
  }
}

/** Throws unless `requestedRole` is a real role this actor may give a new hire. */
const resolveAssignableRole = (actorRole, requestedRole, fallback = 'employee') => {
  if (!requestedRole) return fallback;
  if (!ALL_ROLES.includes(requestedRole)) throw new BadRequestError('Invalid role');
  if (PRIVILEGED_ROLES.includes(requestedRole) && actorRole !== 'admin') {
    throw new ForbiddenError('Only an Admin can give someone the HR or Admin role.');
  }
  return requestedRole;
};

/**
 * Address keys an employee may set on their own record. Everything else in
 * the address JSON (attendance_mode, shift, shift_id, work_location,
 * company_id, education, …) is set by HR and survives a self-edit
 * untouched (audit #13).
 */
const SELF_EDITABLE_ADDRESS_KEYS = [
  'line1', 'line2', 'street', 'landmark', 'city', 'district', 'state', 'pincode', 'postal_code', 'country',
  'personal_email',
];

/**
 * Same JSON value for "did this actually change?": key order, blank values
 * and number-vs-text ("50000" / 50000) don't count. Numbers are compared as
 * text, so long account numbers never lose digits.
 */
const canonicalValue = (v) => {
  if (v === null || v === undefined || v === '') return null;
  if (Array.isArray(v)) return v.map(canonicalValue);
  if (typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) {
      const c = canonicalValue(v[k]);
      if (c !== null) out[k] = c;
    }
    return Object.keys(out).length ? out : null;
  }
  return String(v).trim();
};
const sameStoredValue = (a, b) => JSON.stringify(canonicalValue(a)) === JSON.stringify(canonicalValue(b));

/** HR-controlled address keys that HR may not change on their own record (Admin only). */
const HR_SET_ADDRESS_KEYS = ['attendance_mode', 'shift', 'shift_id', 'work_location'];

/** The stored address with only the self-editable keys taken from `submitted`; null if none were sent. */
const mergeSelfAddress = (stored, submitted) => {
  if (!submitted || typeof submitted !== 'object' || Array.isArray(submitted)) return null;
  const merged = (stored && typeof stored === 'object' && !Array.isArray(stored)) ? { ...stored } : {};
  let changed = false;
  for (const key of SELF_EDITABLE_ADDRESS_KEYS) {
    const value = submitted[key];
    if (value === undefined) continue;
    if (value !== null && typeof value !== 'string' && typeof value !== 'number') continue;
    merged[key] = value === null ? '' : String(value).trim().slice(0, 500);
    changed = true;
  }
  return changed ? merged : null;
};

/** Resolve which company IDs this actor may see/manage. */
async function resolveScopeCompanyIds(req) {
  const homeId = req.user.company_id || getCompanyId(req.user);
  if (req.user.role === 'admin' || req.user.role === 'hr') {
    return getOrgCompanyIds(homeId);
  }
  return [homeId];
}

async function findEmployeeByRef(ref, scopeCompanyIds, select = '*') {
  const scopeIds = [...new Set((scopeCompanyIds || []).map(String).filter(Boolean))];
  if (!scopeIds.length) return null;

  const refIsUuid = isUuid(ref);
  let query = supabaseAdmin
    .from('employees')
    .select(select)
    .in('company_id', scopeIds);

  if (refIsUuid) {
    query = query.eq('id', normalizeId(ref));
  } else {
    // Employee codes restart per company (EMP001…) — may match multiple rows in org scope
    query = query.eq('employee_code', ref).limit(5);
  }

  const { data, error } = await query;
  if (error) throw new BadRequestError(error.message);

  const rows = Array.isArray(data) ? data : (data ? [data] : []);
  if (!rows.length) return null;

  // Prefer exact UUID match; for codes take first in-scope row
  if (refIsUuid) {
    return rows.find((r) => sameId(r.id, ref)) || rows[0];
  }
  return rows[0];
}

/**
 * The employee a write endpoint acts on, found by uuid only (codes restart
 * per company, so across a parent and its subsidiaries one could match the
 * wrong person) and only inside the caller's companies. Callers use the
 * returned row's id from here on, never req.params.id, so the id's letter
 * case can't change any "is this me?" decision (audit #4).
 * `fallbackSelect` is retried when `isMissing(message)` says a column from a
 * migration not yet applied here is missing.
 */
async function loadTargetEmployee(req, scopeCompanyIds, select, fallbackSelect = null, isMissing = () => false) {
  const id = normalizeId(req.params.id);
  const scopeIds = [...new Set((scopeCompanyIds || []).map(String).filter(Boolean))];
  if (!isUuid(id) || !scopeIds.length) throw new NotFoundError('Employee not found');
  const run = (columns) => supabaseAdmin
    .from('employees')
    .select(columns)
    .eq('id', id)
    .in('company_id', scopeIds)
    .maybeSingle();
  let { data, error } = await run(select);
  if (error && fallbackSelect && isMissing(error.message)) {
    ({ data, error } = await run(fallbackSelect));
  }
  if (error) throw new BadRequestError(error.message);
  if (!data || !scopeIds.includes(String(getCompanyId(data)))) {
    throw new NotFoundError('Employee not found');
  }
  return data;
}

/**
 * Admin / HR may assign company_id to home or any child in the org.
 * Others always use their home company.
 */
async function resolveTargetCompanyId(req, requestedCompanyId) {
  const homeId = req.user.company_id || getCompanyId(req.user);
  const canAssign = req.user.role === 'admin' || req.user.role === 'hr';
  if (!canAssign || !requestedCompanyId) {
    return homeId;
  }
  const target = String(requestedCompanyId);
  const allowed = await isCompanyInOrg(homeId, target);
  if (!allowed) {
    throw new ForbiddenError('You can only assign employees to your company or its child companies');
  }
  const row = await getCompanyById(target);
  if (!row || row.is_active === false) {
    throw new BadRequestError('Target company is inactive or not found');
  }
  return target;
}

const create = async (req, res, next) => {
  try {
    const requestedCompanyId = req.body.company_id || req.body.companyId;
    const companyId = await resolveTargetCompanyId(req, requestedCompanyId);
    // Only an Admin creates HR or Admin accounts (audit #41). Checked before
    // anything else so a refused hire costs nothing. Bulk import comes
    // through here too, one row at a time.
    const newHireRole = sentRole(req.body.role);
    if (PRIVILEGED_ROLES.includes(newHireRole) && req.user.role !== 'admin') {
      throw refusal(req, {
        companyId,
        action: 'create',
        attempted: { role: newHireRole, email: req.body.email },
        message: 'Only an Admin can create an HR or Admin account.',
      });
    }
    // Subscription seat enforcement — no-ops if this company has no
    // subscription wired up yet (see subscription.service.js's assertSeatAvailable).
    await require('../services/subscription.service').assertSeatAvailable(companyId);
    const tempPassword = generateDefaultPassword();
    await authService.assertPasswordPolicy(tempPassword, companyId);
    const passwordHash = await authService.hashPassword(tempPassword);

    // Scoped to the company being hired into — the same email legitimately
    // existing at a different, unrelated company must not block this hire.
    const { data: existing } = await supabaseAdmin
      .from('employees')
      .select('id')
      .eq('email', req.body.email)
      .eq('company_id', companyId)
      .maybeSingle();

    if (existing) throw new ConflictError('An employee with this email already exists at this company');

    const isOnboardingMode = req.body.onboarding_mode === true || req.body.onboardingMode === true;
    const fields = isOnboardingMode
      ? pickEmployeeFields(req.body)
      : pickEmployeeFields(req.body);
    fields.role = resolveAssignableRole(req.user.role, newHireRole, 'employee');
    const employeeCode = await allocateNextEmployeeCode(companyId);
    // `source: 'bulk_import'` is set by the frontend's CSV-import loop
    // (BulkImportPanel.jsx) so this one endpoint — the only employee-create
    // path that exists — can tell "added one at a time" apart from
    // "migrated via bulk import" and send the right template. Anything
    // else (including the normal Add Employee form, which never sends it)
    // falls through to the regular welcome email.
    const isBulkImport = req.body.source === 'bulk_import';
    const expiryHours = isOnboardingMode ? 72 : 48;
    const insertFields = {
      ...fields,
      email: req.body.email,
      employee_code: employeeCode,
      password_hash: passwordHash,
      must_change_password: true,
      temp_password_expires_at: new Date(Date.now() + expiryHours * 60 * 60 * 1000).toISOString(),
      ...companyIdFields(companyId, fields.address),
    };
    // Personal details are optional for HR/Admin. Whatever they left blank,
    // the employee is asked for on first sign-in (profileCompletion.service).
    insertFields.profile_completed = profileCompletion.isProfileComplete(insertFields);

    // Columns from migrations that may not be applied yet in this
    // environment: retried without them rather than failing the hire.
    let { data, error } = await supabaseAdmin.from('employees').insert(insertFields).select().single();
    for (let attempt = 0; error && attempt < 2; attempt += 1) {
      if (isMissingColumnError(error.message, 'temp_password_expires_at')) {
        delete insertFields.temp_password_expires_at;
      } else if (profileCompletion.isMissingProfileColumn(error.message)) {
        delete insertFields.profile_completed;
      } else {
        break;
      }
      ({ data, error } = await supabaseAdmin.from('employees').insert(insertFields).select().single());
    }

    if (error) {
      // The pre-check above (existing) only reduces the race window, it
      // doesn't close it — two concurrent creates for the same email can
      // both pass it and both reach this insert. The DB's own unique
      // constraint is the real guard; surface it as the same clean message
      // instead of leaking the raw Postgres constraint-violation text.
      if (error.code === '23505') {
        throw new ConflictError('An employee with this email already exists at this company');
      }
      throw new BadRequestError(error.message);
    }

    const employee = omitSensitive(data, ['password_hash']);
    let onboardingLink = null;
    // The welcome / invite email goes out in the background — HR's screen
    // (and every row of a bulk import) no longer waits on the mail server.
    // Only the invite link is worked out first, since the response returns it.
    const emailService = require('../services/email.service');
    if (isOnboardingMode) {
      try {
        const onboardingToken = authService.generateOnboardingToken(employee);
        const { getTenantOrigin } = require('../services/tenantUrl.service');
        onboardingLink = `${await getTenantOrigin(companyId)}/employee-onboarding?token=${onboardingToken}`;
      } catch (linkErr) {
        logger.warn('Onboarding link could not be built', { employeeId: employee.id, error: linkErr.message });
      }
      if (onboardingLink) {
        const link = onboardingLink;
        runInBackground('onboarding invite email', async () => {
          const settingsService = require('../services/settings.service');
          const profile = await settingsService.getSetting('company_profile', {}, companyId);
          await emailService.onboardingInviteEmail(employee, tempPassword, link, { companyName: profile?.name || '', expiryHours: 72 });
        });
      }
    } else {
      runInBackground(isBulkImport ? 'bulk import email' : 'welcome email', () => (isBulkImport
        ? emailService.bulkImportEmail(employee, tempPassword, { expiryHours })
        : emailService.welcomeEmail(employee, tempPassword)));
    }
    // WhatsApp connects to the mobile number entered here, no JOIN needed
    // (owner's decision, 2 Nov 2026); nothing happens if the company's
    // WhatsApp is off. A bulk import gets the existing-employee message.
    runInBackground('whatsapp connect', () => require('../services/whatsappLink.service').connectAddedEmployee({
      employeeId: employee.id, phone: employee.phone, companyId, existingStaff: isBulkImport,
    }));
    require('../services/webhook.service').dispatchWebhookEvent(companyId, 'employee.created', {
      employeeId: employee.id, employeeCode: employee.employee_code, firstName: employee.first_name,
      lastName: employee.last_name, email: employee.email, role: employee.role, department: employee.department,
    });
    // For onboarding mode, return the link so HR can share manually if email fails.
    // Never return tempPassword in the API body — credentials go by email only.
    const responseBody = { employee };
    if (onboardingLink) responseBody.onboardingLink = onboardingLink;
        auditFromRequest(req, {
      actionType: 'employee.create', targetType: 'employee', targetId: responseBody?.employee?.id,
      afterState: { email: responseBody?.employee?.email, role: responseBody?.employee?.role,
        department: responseBody?.employee?.department, designation: responseBody?.employee?.designation },
    });
    successResponse(res, 'Employee created. Temporary password sent by email.', responseBody, null, 201);
  } catch (err) { next(err); }
};

const getAll = async (req, res, next) => {
  try {
    const scopeIds = await resolveScopeCompanyIds(req);
    const { page, limit, offset } = paginate(req.query);

    const scopeIdSet = new Set((scopeIds || []).map(String));

    // The list view never renders salary_details/bank_details — excluding
    // them from the select (not just the response) means a company-wide
    // roster fetch can't be used to scrape every employee's compensation/
    // bank data via the Network tab, even by an already-privileged HR/Admin
    // session (audit finding M-11).
    let query = supabaseAdmin
      .from('employees')
      .select(
        `id, employee_code, first_name, last_name, email, phone, date_of_birth, gender, address,
         role, department, designation, manager_id, date_of_joining, employment_type,
         emergency_contact, profile_picture, is_active, must_change_password, created_at, updated_at,
         company_id, manager:manager_id(id, first_name, last_name), company:company_id(id, name, slug)`,
        { count: 'exact' },
      )
      .in('company_id', scopeIds)
      .neq('role', 'admin')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (req.query.department) query = query.eq('department', req.query.department);
    if (req.query.role) query = query.eq('role', req.query.role);
    if (req.query.is_active !== undefined) query = query.eq('is_active', req.query.is_active === 'true');
    if (req.query.company_id || req.query.companyId) {
      const filterCid = String(req.query.company_id || req.query.companyId);
      if (!scopeIdSet.has(filterCid)) {
        throw new ForbiddenError('Invalid company filter');
      }
      query = query.eq('company_id', filterCid);
    }

    const { data, error, count } = await query;
    if (error) throw new BadRequestError(error.message);

    // profile_picture is a private storage path; sign the whole page in one
    // call so list rows can show photos. A signing failure only costs the
    // photos — rows still render with initials.
    let photoUrls = new Map();
    try {
      photoUrls = await getSignedUrls(STORAGE_BUCKETS.profilePictures, (data || []).map((e) => e.profile_picture), 86400);
    } catch (e) {
      logger.warn('[Employees] Could not sign list photos', { error: e.message });
    }

    const sanitized = (data || []).map((e) => ({
      ...omitSensitive(e, ['password_hash']),
      profile_picture_url: photoUrls.get(e.profile_picture) || null,
    }));
    successResponse(res, 'Employees fetched', sanitized, buildMeta(page, limit, count || 0));
  } catch (err) { next(err); }
};

const getById = async (req, res, next) => {
  try {
    const scopeIds = await resolveScopeCompanyIds(req);
    const data = await findEmployeeByRef(
      req.params.id,
      scopeIds,
      '*, manager:manager_id(id, first_name, last_name, email), company:company_id(id, name, slug)',
    );

    if (!data) throw new NotFoundError('Employee not found');

    const isSelf = sameId(req.user.id, data.id);
    const isPrivileged = ['hr', 'admin'].includes(req.user.role);
    const isManager = req.user.role === 'manager' && sameId(data.manager_id, req.user.id);

    // Employees may only open their own profile; managers see direct reports; HR/Admin see all.
    if (!isSelf && !isPrivileged && !isManager) {
      throw new ForbiddenError('Not authorized to view this employee');
    }
    if (!isSelf) await assertEmployeesPermission(req, 'view', data);

    let profilePictureUrl = null;
    if (data.profile_picture) {
      try {
        profilePictureUrl = await getSignedUrl(STORAGE_BUCKETS.profilePictures, data.profile_picture, 86400);
      } catch {
        /* stale/missing file — fall back to initials on the frontend */
      }
    }

    // A manager viewing a direct report (not themselves, not HR/Admin) gets
    // the same compensation-data boundary the Payroll module already
    // enforces elsewhere — salary/bank details are never returned, matching
    // getTeam's narrower column list for the same viewer type. emergency_contact
    // stays: a manager legitimately needs it.
    const omitFields = ['password_hash'];
    if (isManager && !isSelf && !isPrivileged) {
      omitFields.push('salary_details', 'bank_details');
    }

    // Informational only — no automated purge runs against this. Retention
    // window is a business/legal decision the product owner should confirm
    // per applicable local labor law; 90 days is a placeholder default, not
    // researched jurisdiction-specific advice. See settings key below.
    let dataRetentionReviewAt = null;
    if (data.employment_status === 'offboarded' && data.offboarded_at) {
      const settingsService = require('../services/settings.service');
      const retentionDays = await settingsService.getNumber('employee_data_retention_days', 90, getCompanyId(data));
      dataRetentionReviewAt = new Date(new Date(data.offboarded_at).getTime() + retentionDays * 86400000).toISOString();
    }

    successResponse(res, 'Employee fetched', {
      ...omitSensitive(data, omitFields),
      profile_picture_url: profilePictureUrl,
      data_retention_review_at: dataRetentionReviewAt,
    });
  } catch (err) { next(err); }
};

const update = async (req, res, next) => {
  try {
    const scopeIds = await resolveScopeCompanyIds(req);
    const baseColumns = 'id, role, is_active, phone, address, company_id, designation, department, manager_id, salary_details, bank_details';
    const existing = await loadTargetEmployee(
      req,
      scopeIds,
      `${baseColumns}, profile_self_edit_used`,
      baseColumns,
      (message) => isMissingColumnError(message, 'profile_self_edit_used'),
    );
    const targetId = existing.id;

    // Decided from the stored row, not the id as typed (audit #4).
    const isSelf = sameId(req.user.id, targetId);
    const isPrivileged = ['hr', 'admin'].includes(req.user.role);

    if (!isSelf && !isPrivileged) {
      throw new ForbiddenError('Not authorized to update this employee');
    }

    // What this request would change about the account itself, for the
    // role and access rules (assertMayChangeAccount).
    const requestedRole = sentRole(req.body.role);
    if (requestedRole !== undefined && !ALL_ROLES.includes(requestedRole)) {
      throw new BadRequestError('Invalid role');
    }
    const newRole = requestedRole !== undefined && requestedRole !== existing.role ? requestedRole : undefined;
    const requestedActive = sentBoolean(req.body.is_active, 'is_active');
    const wasActive = existing.is_active !== false;
    const requestedCompanyId = req.body.company_id || req.body.companyId;
    await assertMayChangeAccount(req, existing, {
      action: 'update',
      newRole,
      removesAccess: requestedActive === false && wasActive,
      restoresAccess: requestedActive === true && !wasActive,
      changesPhone: req.body.phone !== undefined && digitsOnly(req.body.phone) !== digitsOnly(existing.phone),
      changesCompany: isPrivileged && Boolean(requestedCompanyId) && !sameId(requestedCompanyId, getCompanyId(existing)),
    });

    // Audit #9: Settings → User & Role Management guards editing someone
    // else's record. Checked here, not in the route, because the route also
    // accepts employee codes. The Admin always passes.
    if (!isSelf) await assertEmployeesPermission(req, 'edit', existing);

    // Item 3: the narrow self-edit path (a non-HR/Admin editing their own
    // record — the dedicated "Edit my info" flow) is allowed exactly once.
    // isPrivileged self-editors (HR/Admin editing themselves) go through
    // the branch below instead and are unaffected by this lock — that path
    // already has its own, separate N-01 restrictions on sensitive fields.
    const isNarrowSelfEdit = isSelf && !isPrivileged;
    if (isNarrowSelfEdit && existing.profile_self_edit_used) {
      throw new ForbiddenError('You\'ve already used your one-time profile edit. Contact HR/Admin to make further changes.');
    }

    const allowedFields = isPrivileged
      ? pickEmployeeFields(req.body)
      : {
          first_name: req.body.first_name,
          last_name: req.body.last_name,
          phone: req.body.phone,
          date_of_birth: req.body.date_of_birth,
          gender: req.body.gender,
          address: req.body.address,
          emergency_contact: req.body.emergency_contact,
          profile_picture: req.body.profile_picture,
        };

    // Item 2 (revised by product decision): bank_details may be set by the
    // employee themselves via the narrow self-edit path regardless of
    // whether a value already exists — the earlier "only while unset"
    // restriction (N-01's original reasoning: redirecting your own salary
    // payments) is relaxed here in favor of letting employees correct their
    // own bank details any time. This is still scoped to isNarrowSelfEdit
    // (not available to a privileged self-editor via the branch below) and
    // still gated by the same one-time profile_self_edit_used lock as every
    // other field in this whitelist — once that lock is set, this whole
    // branch is unreachable regardless of bank_details' prior state.
    if (isNarrowSelfEdit && req.body.bank_details !== undefined) {
      allowedFields.bank_details = req.body.bank_details;
    }

    // A photo path from a self-edit must be one of the person's own uploads
    // (uploadProfilePicture stores them under "<their id>/"), so nobody can
    // point their photo at another file in that storage area.
    if (isNarrowSelfEdit && allowedFields.profile_picture !== undefined) {
      const path = String(allowedFields.profile_picture || '');
      const ownFolder = `${String(targetId).toLowerCase()}/`;
      if (path && (!path.toLowerCase().startsWith(ownFolder) || path.includes('..') || path.includes('//'))) {
        delete allowedFields.profile_picture;
      }
    }

    // The role is written only when it actually changes, after
    // assertMayChangeAccount allowed it. A blank role no longer falls back
    // to 'employee' (that silently demoted whoever was being edited).
    delete allowedFields.role;
    if (isPrivileged && newRole !== undefined) {
      allowedFields.role = newRole;
    }
    if (allowedFields.is_active !== undefined) {
      allowedFields.is_active = requestedActive;
    }

    delete allowedFields.password_hash;
    delete allowedFields.email;
    delete allowedFields.companyId;

    // Audit finding N-01: isPrivileged alone unlocked the full field
    // whitelist even when the target IS the caller — an HR/Admin editing
    // their own record got the same privileged-field access as editing
    // anyone else's. Same drop-from-whitelist pattern as password_hash/
    // email/companyId above: these are never settable on your own record,
    // regardless of role. Extended (self-service audit) to also cover
    // designation/department/role — the original N-01 list left these
    // three settable by a privileged self-editor, letting e.g. an HR user
    // change their own designation/department, or an admin/HR user
    // reassign their own role, via this same isSelf path.
    if (isSelf) {
      delete allowedFields.salary_details;
      // bank_details: left alone here when the item 2 branch above already
      // populated it (isNarrowSelfEdit path) — otherwise (a privileged
      // self-editor, i.e. HR/Admin editing their own record) stripped, same
      // as salary_details/role/etc. below.
      if (!(isNarrowSelfEdit && allowedFields.bank_details !== undefined)) {
        delete allowedFields.bank_details;
      }
      delete allowedFields.is_active;
      delete allowedFields.manager_id;
      delete allowedFields.designation;
      delete allowedFields.department;
      delete allowedFields.role;

      // Audit #13: the address JSON also holds what HR sets — attendance
      // mode, shift, work location. A self-edit only changes the real
      // address lines, merged into what is stored; it can't set or remove
      // anything else in there. The Admin (account owner) may still set
      // their own; HR is told to ask an Admin instead of being silently
      // ignored, since HR exempting themselves from office check-in is the
      // fraud this closes.
      if (allowedFields.address !== undefined && req.user.role !== 'admin') {
        const submitted = allowedFields.address;
        if (isPrivileged && submitted && typeof submitted === 'object' && !Array.isArray(submitted)) {
          const blank = (v) => (v === undefined || v === null || v === '' ? null : JSON.stringify(v));
          const changedHrKey = HR_SET_ADDRESS_KEYS.find((k) => k in submitted
            && blank(submitted[k]) !== blank(existing.address?.[k]));
          if (changedHrKey) {
            throw refusal(req, {
              target: existing,
              action: 'self_attendance_settings',
              attempted: { [changedHrKey]: submitted[changedHrKey] },
              message: 'Your own attendance mode, shift and work location are set by an Admin. Ask an Admin to change them.',
            });
          }
        }
        const merged = mergeSelfAddress(existing.address, allowedFields.address);
        if (merged) allowedFields.address = merged;
        else delete allowedFields.address;
      }
    }

    // Admin / HR may move employee within org (parent ↔ child)
    const previousCompanyId = getCompanyId(existing);
    let stampCompanyId = previousCompanyId;
    if (isPrivileged && requestedCompanyId) {
      stampCompanyId = await resolveTargetCompanyId(req, requestedCompanyId);
      allowedFields.company_id = stampCompanyId;
    } else {
      delete allowedFields.company_id;
    }

    if (allowedFields.address !== undefined) {
      allowedFields.address = withCompanyId(allowedFields.address, stampCompanyId);
      // Only HR/Admin edits write the company column; a self-edit leaves it be.
      if (isPrivileged) allowedFields.company_id = stampCompanyId;
    } else if (allowedFields.company_id) {
      allowedFields.address = withCompanyId(existing.address, stampCompanyId);
    }

    // Audit #10: reactivating someone, or moving an active person in from
    // outside the group, takes a seat from the paying company's pool. A move
    // inside the group costs nothing (assertSeatAvailable works that out).
    if (isPrivileged && requestedActive === true && !wasActive) {
      await require('../services/subscription.service').assertSeatAvailable(stampCompanyId || previousCompanyId);
    } else if (isPrivileged && wasActive && requestedActive !== false
      && stampCompanyId && !sameId(stampCompanyId, previousCompanyId)) {
      await require('../services/subscription.service')
        .assertSeatAvailable(stampCompanyId, { fromCompanyId: previousCompanyId });
    }

    // The Edit Employee form sends the whole salary record. Keep what the
    // Payroll setup card owns (ESI choice, extra-deduction opt-outs), so a
    // form save never undoes it.
    const previousSalary = existing.salary_details || null;
    if (allowedFields.salary_details && typeof allowedFields.salary_details === 'object' && previousSalary) {
      const merged = { ...previousSalary, ...allowedFields.salary_details };
      for (const k of ['deduction_optouts', 'esi_applicable', 'esi_set', 'payroll_setup_updated_at', 'payroll_setup_updated_by']) {
        if (previousSalary[k] !== undefined) merged[k] = previousSalary[k];
        else delete merged[k];
      }
      allowedFields.salary_details = merged;
    }

    // Owner's rule (17 Nov 2026): only an Admin changes an HR or Admin
    // user's salary or bank details. The edit form sends both on every save,
    // so they are refused only when they actually change.
    if (!isSelf && req.user.role !== 'admin' && ['hr', 'admin'].includes(existing.role)) {
      for (const field of ['salary_details', 'bank_details']) {
        if (allowedFields[field] === undefined) continue;
        if (sameStoredValue(allowedFields[field], existing[field])) {
          delete allowedFields[field];
          continue;
        }
        throw refusal(req, {
          target: existing,
          action: 'update',
          attempted: { [field]: 'changed' },
          message: 'Only an Admin can change the pay or bank details of HR and Admin users.',
        });
      }
    }

    // Item 3: the attempt itself consumes the one-time self-edit allowance,
    // atomically with the field changes — set unconditionally on any
    // successful narrow-self-edit submission, not just when bank_details
    // was touched.
    if (isNarrowSelfEdit) {
      allowedFields.profile_self_edit_used = true;
    }

    let { data, error } = await supabaseAdmin
      .from('employees')
      .update(allowedFields)
      .eq('id', targetId)
      .select()
      .single();

    if (error && isNarrowSelfEdit && isMissingColumnError(error.message, 'profile_self_edit_used')) {
      delete allowedFields.profile_self_edit_used;
      ({ data, error } = await supabaseAdmin
        .from('employees')
        .update(allowedFields)
        .eq('id', targetId)
        .select()
        .single());
    }

    if (error) throw new BadRequestError(error.message);

    // A WhatsApp connection made from the old mobile number follows the new one.
    if (allowedFields.phone !== undefined && data) {
      runInBackground('whatsapp number change', () => require('../services/whatsappLink.service').followNumberChange({
        employeeId: targetId, phone: data.phone,
      }));
    }

    // Personal details are optional for HR/Admin, on edit as on add. If they
    // filled everything in, the employee isn't asked; if anything is still
    // missing, the employee is asked for it on their next sign-in.
    if (isPrivileged && !isSelf) {
      const complete = await profileCompletion.syncAfterHrEdit(targetId);
      if (complete != null && data) data.profile_completed = complete;
    }

    // PF / PT / TDS changed from this form — admins hear about it the same
    // way as from the Payroll setup card. (A first salary is setup: nothing sent.)
    if (isPrivileged && !isSelf && previousSalary && allowedFields.salary_details) {
      require('../services/payroll.service').notifyPayrollSetupChange({
        employee: data,
        beforeSalary: previousSalary,
        afterSalary: allowedFields.salary_details,
        actor: req.user,
        ipAddress: req.ip,
      }).catch((e) => logger.warn('Payroll setup change notice failed', { error: e.message }));
    }

    if (isPrivileged) {
      await logCareerEvents({
        employeeId: targetId,
        companyId: stampCompanyId,
        before: existing,
        after: allowedFields,
        actorId: req.user.id,
      });
    }

    // Cross-tenant isolation audit (device_employee_mapping lifecycle):
    // a company transfer otherwise leaves this employee's biometric device
    // mapping(s) resolving to their OLD company's device_serial(s) forever —
    // device_employee_mapping has no company_id of its own, only a live join
    // to employees.company_id, so the old company's HR/Admin would keep
    // seeing this employee's name/code in their device mapping list
    // indefinitely, and the device_user_id slot stays permanently occupied
    // instead of freeing up for re-mapping. Purge on transfer; the employee
    // needs re-enrolling against a device the NEW company actually owns
    // regardless, since biometric enrollment doesn't travel with a transfer.
    if (stampCompanyId && String(stampCompanyId) !== String(previousCompanyId)) {
      const { error: mappingCleanupError } = await supabaseAdmin
        .from('device_employee_mapping')
        .delete()
        .eq('employee_id', targetId);
      if (mappingCleanupError) {
        logger.warn('Failed to purge device mappings after company transfer', {
          employeeId: targetId, error: mappingCleanupError.message,
        });
      }
    }

    // Audit #6: switching someone off, or changing their role, ends every
    // session they have (access and refresh tokens), not just new logins.
    if ((allowedFields.is_active === false && wasActive) || allowedFields.role !== undefined) {
      try {
        await authService.bumpTokenVersion(targetId);
      } catch (e) {
        logger.error('Could not sign the employee out after an access change', { employeeId: targetId, error: e.message });
      }
    }

    // Item 5: audit trail. isNarrowSelfEdit gets its own action_type
    // (profile.self_edit) — item 5 explicitly calls out logging this
    // employee self-action, not just HR/Admin writes.
    require('../services/auditLog.service').logAudit({
      companyId: stampCompanyId,
      actorId: req.user.id,
      actorRole: req.user.role,
      actionType: isNarrowSelfEdit ? 'profile.self_edit' : 'employee.update',
      targetType: 'employee',
      targetId,
      afterState: allowedFields,
      ipAddress: req.ip,
    }).catch((e) => logger.warn('Audit log failed', { error: e.message }));

    // A role change gets its own entry, easy to find in the Audit Log.
    if (allowedFields.role !== undefined) {
      logAudit({
        companyId: stampCompanyId,
        actorId: req.user.id,
        actorRole: req.user.role,
        actionType: 'employee.role_change',
        targetType: 'employee',
        targetId,
        beforeState: { role: existing.role },
        afterState: { role: allowedFields.role },
        ipAddress: req.ip,
      }).catch((e) => logger.warn('Audit log failed', { error: e.message }));
    }

    successResponse(res, 'Employee updated', omitSensitive(data, ['password_hash']));
  } catch (err) { next(err); }
};

const uploadPhoto = async (req, res, next) => {
  try {
    if (!req.file) throw new BadRequestError('Photo is required');
    if (!String(req.file.mimetype || '').startsWith('image/')) {
      throw new BadRequestError('Photo must be an image file');
    }

    const scopeIds = await resolveScopeCompanyIds(req);
    const existing = await loadTargetEmployee(req, scopeIds, 'id, role, is_active, company_id');
    const targetId = existing.id;

    const isSelf = sameId(req.user.id, targetId);
    const isPrivileged = ['hr', 'admin'].includes(req.user.role);
    if (!isSelf && !isPrivileged) {
      throw new ForbiddenError('Not authorized to update this employee\'s photo');
    }
    if (!isSelf) await assertEmployeesPermission(req, 'edit', existing);
    await assertMayChangeAccount(req, existing, { action: 'photo' });

    const { path } = await uploadProfilePicture(req.file, targetId);

    const { data, error } = await supabaseAdmin
      .from('employees')
      .update({ profile_picture: path })
      .eq('id', targetId)
      .select()
      .single();
    if (error) throw new BadRequestError(error.message);

    const profilePictureUrl = await getSignedUrl(STORAGE_BUCKETS.profilePictures, path, 86400);
    successResponse(res, 'Photo updated', {
      ...omitSensitive(data, ['password_hash']),
      profile_picture_url: profilePictureUrl,
    });
  } catch (err) { next(err); }
};

/**
 * Audit finding N-10: this is a PERMANENT, CASCADING HARD DELETE, not a
 * soft-delete/deactivation. `employees.id` cascades (ON DELETE CASCADE,
 * see schema.sql) through attendance, leaves, payroll, documents,
 * enrollments, and every other table with an employee_id FK — all of that
 * history is irrecoverably destroyed the moment this runs. Whether this
 * should instead be a softer/reversible flow is an open product decision,
 * not resolved here — this fix only addresses the concrete bug that the
 * Storage files those rows pointed to were never cleaned up, so they
 * silently outlived the DB rows as permanently orphaned objects. Storage
 * cleanup now runs BEFORE the DB delete so the file paths are still
 * derivable (all namespaced under this employee's own id).
 */
/** True when the employment_status/offboarded_at/offboarded_by migration hasn't been applied yet in this environment. */
const isMissingOffboardColumn = (message) =>
  ['employment_status', 'offboarded_at', 'offboarded_by'].some((col) => isMissingColumnError(message, col));

/**
 * Resolves audit finding N-10: this used to be a real hard delete cascading
 * through attendance/leaves/payroll/documents/enrollments. Product decision
 * (2026-08-28): offboarding retains all historical data — nothing here is
 * deleted or removed from storage. It's functionally equivalent to
 * deactivate() (is_active=false, token revoked) plus the richer
 * employment_status/offboarded_at/offboarded_by tracking that distinguishes
 * "left the company" from other reasons an account might be deactivated.
 * Every existing `.eq('is_active', true)` filter (seat usage, dashboards,
 * org charts, auth) keeps excluding this employee with no other code
 * changes needed, since is_active is still set here exactly as before.
 */
const offboard = async (req, res, next) => {
  try {
    const scopeIds = await resolveScopeCompanyIds(req);
    const existing = await loadTargetEmployee(
      req,
      scopeIds,
      'id, role, is_active, address, company_id, employment_status',
      'id, role, is_active, address, company_id',
      isMissingOffboardColumn,
    );
    const targetId = existing.id;
    await assertMayChangeAccount(req, existing, { action: 'offboard', removesAccess: true });
    if (existing.employment_status === 'offboarded') {
      throw new ConflictError('Employee is already offboarded');
    }

    const reason = req.body?.reason ? String(req.body.reason).trim() : null;
    // The last day they worked — payroll pays the month up to it (defect D7:
    // leavers used to get no payslip at all). Defaults to today.
    const todayIst = require('moment-timezone').tz('Asia/Kolkata').format('YYYY-MM-DD');
    const lastWorkingDay = req.body?.last_working_day ? String(req.body.last_working_day).slice(0, 10) : todayIst;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(lastWorkingDay) || Number.isNaN(Date.parse(`${lastWorkingDay}T00:00:00Z`))) {
      throw new BadRequestError('Last working day must be a date (YYYY-MM-DD)');
    }
    const { data: joinRow } = await supabaseAdmin.from('employees').select('date_of_joining').eq('id', targetId).maybeSingle();
    if (joinRow?.date_of_joining && lastWorkingDay < String(joinRow.date_of_joining).slice(0, 10)) {
      throw new BadRequestError('Last working day can\'t be before the joining date');
    }
    const fullUpdate = {
      is_active: false,
      employment_status: 'offboarded',
      offboarded_at: new Date().toISOString(),
      offboarded_by: req.user.id,
      last_working_day: lastWorkingDay,
    };

    let { data, error } = await supabaseAdmin
      .from('employees')
      .update(fullUpdate)
      .eq('id', targetId)
      .select()
      .single();

    // Before 20261102_payroll_last_working_day.sql runs there is no
    // last_working_day column; payroll then uses the offboarding date.
    if (error && isMissingColumnError(error.message, 'last_working_day')) {
      const { last_working_day: _lwd, ...withoutLwd } = fullUpdate;
      ({ data, error } = await supabaseAdmin
        .from('employees')
        .update(withoutLwd)
        .eq('id', targetId)
        .select()
        .single());
    }

    if (error && isMissingOffboardColumn(error.message)) {
      ({ data, error } = await supabaseAdmin
        .from('employees')
        .update({ is_active: false })
        .eq('id', targetId)
        .select()
        .single());
    }
    if (error) throw new BadRequestError(error.message);

    // Same redundant revocation path as deactivate() (audit finding N-12).
    await authService.bumpTokenVersion(targetId);

    await supabaseAdmin.from('employee_career_events').insert({
      employee_id: targetId,
      company_id: getCompanyId(existing),
      event_type: 'offboarded',
      note: reason,
      effective_date: new Date().toISOString().slice(0, 10),
      created_by: req.user.id,
    }).then(({ error: logError }) => {
      if (logError) logger.warn('Failed to log offboard career event', { employeeId: targetId, error: logError.message });
    });

    require('../services/auditLog.service').logAudit({
      companyId: getCompanyId(existing),
      actorId: req.user.id,
      actorRole: req.user.role,
      actionType: 'employee.offboard',
      targetType: 'employee',
      targetId,
      afterState: { reason },
      ipAddress: req.ip,
    }).catch((e) => logger.warn('Audit log failed', { error: e.message }));

    // Offboarding here is immediate (is_active/employment_status flip in the
    // same call), not a staged notice-period flow with a future last working
    // day — so accountDeactivatedEmail (which is literally true right now)
    // is what's wired here. offboardingInitiatedEmail/exitChecklistEmail/
    // finalSettlementEmail assume a staged resignation process with its own
    // dates this codebase doesn't track yet — built, not wired, until that's
    // a real feature.
    if (data?.email) {
      const { accountDeactivatedEmail } = require('../services/email.service');
      accountDeactivatedEmail(data, {}).catch((e) => logger.warn('accountDeactivatedEmail failed', { error: e.message }));
    }

    require('../services/webhook.service').dispatchWebhookEvent(getCompanyId(existing), 'employee.offboarded', {
      employeeId: targetId, reason, offboardedAt: fullUpdate.offboarded_at,
    });

    successResponse(res, 'Employee offboarded', omitSensitive(data, ['password_hash']));
  } catch (err) { next(err); }
};

/**
 * Genuine right-to-erasure hard delete — deliberately separate from
 * offboard(), only usable on an already-offboarded employee, and gated
 * behind the caller re-typing the employee's code as an explicit
 * confirmation step (checked server-side, never trusted from the client
 * alone). Logs a standalone employee_erasure_log row BEFORE deleting, since
 * that table is intentionally not foreign-keyed to employees(id) — it must
 * survive the very row it's describing.
 */
const permanentlyErase = async (req, res, next) => {
  try {
    const scopeIds = await resolveScopeCompanyIds(req);
    const existing = await loadTargetEmployee(
      req,
      scopeIds,
      'id, role, is_active, address, company_id, employment_status, employee_code, first_name, last_name, email',
      'id, role, is_active, address, company_id, employee_code, first_name, last_name, email',
      isMissingOffboardColumn,
    );
    const targetId = existing.id;
    await assertMayChangeAccount(req, existing, { action: 'erase', removesAccess: true });
    // Pre-migration, employment_status is undefined here — fails closed
    // (blocks erasure entirely) rather than allowing it incorrectly.
    if (existing.employment_status !== 'offboarded') {
      throw new ConflictError('Employee must be offboarded before their data can be permanently erased');
    }

    const confirmation = String(req.body?.confirm_employee_code || '').trim();
    if (!confirmation || confirmation.toLowerCase() !== String(existing.employee_code || '').toLowerCase()) {
      throw new BadRequestError('Type the employee\'s exact employee code to confirm permanent erasure');
    }

    await supabaseAdmin.from('employee_erasure_log').insert({
      employee_id: existing.id,
      employee_code: existing.employee_code,
      employee_name: `${existing.first_name || ''} ${existing.last_name || ''}`.trim(),
      employee_email: existing.email,
      company_id: getCompanyId(existing),
      erased_by: req.user.id,
      reason: req.body?.reason ? String(req.body.reason).trim() : null,
    });

    require('../services/auditLog.service').logAudit({
      companyId: getCompanyId(existing),
      actorId: req.user.id,
      actorRole: req.user.role,
      actionType: 'employee.erase',
      targetType: 'employee',
      targetId,
      beforeState: { employeeCode: existing.employee_code, name: `${existing.first_name || ''} ${existing.last_name || ''}`.trim() },
      ipAddress: req.ip,
    }).catch((e) => logger.warn('Audit log failed', { error: e.message }));

    await Promise.all([
      deleteEmployeeFolder(STORAGE_BUCKETS.documents, targetId),
      deleteEmployeeFolder(STORAGE_BUCKETS.receipts, targetId),
      deleteEmployeeFolder(STORAGE_BUCKETS.profilePictures, targetId),
      deleteEmployeeFolder(STORAGE_BUCKETS.payslips, targetId),
    ]);
    await supabaseAdmin.from('employees').delete().eq('id', targetId);
    successResponse(res, 'Employee data permanently erased');
  } catch (err) { next(err); }
};

const getTeam = async (req, res, next) => {
  try {
    const scopeIds = await resolveScopeCompanyIds(req);
    const managerId = req.params.managerId || req.user.id;
    const isPrivileged = ['hr', 'admin'].includes(req.user.role);
    // Managers may only fetch their own reports; HR/Admin may query any manager.
    if (!isPrivileged && !sameId(managerId, req.user.id)) {
      throw new ForbiddenError('Not authorized to view this team');
    }
    const { data, error } = await supabaseAdmin
      .from('employees')
      .select('id, employee_code, first_name, last_name, email, department, designation, is_active, address, company_id')
      .eq('manager_id', managerId)
      .eq('is_active', true);

    if (error) throw new BadRequestError(error.message);
    const scoped = (data || []).filter((e) => scopeIds.map(String).includes(String(getCompanyId(e))));
    successResponse(res, 'Team fetched', scoped.map((e) => {
      const { address, ...rest } = e;
      return rest;
    }));
  } catch (err) { next(err); }
};

const deactivate = async (req, res, next) => {
  try {
    const scopeIds = await resolveScopeCompanyIds(req);
    const existing = await loadTargetEmployee(req, scopeIds, 'id, role, is_active, address, company_id');
    const targetId = existing.id;
    await assertMayChangeAccount(req, existing, { action: 'deactivate', removesAccess: true });

    const { data, error } = await supabaseAdmin
      .from('employees')
      .update({ is_active: false })
      .eq('id', targetId)
      .select()
      .single();

    if (error) throw new BadRequestError(error.message);
    // Audit finding N-12: is_active already kills the session via
    // authenticate()'s live re-check, but bump token_version too for a
    // redundant, independent revocation path.
    await authService.bumpTokenVersion(targetId);
        auditFromRequest(req, {
      actionType: 'employee.deactivate', targetType: 'employee', targetId,
      afterState: { isActive: data?.is_active },
    });
    successResponse(res, 'Employee deactivated', omitSensitive(data, ['password_hash']));
  } catch (err) { next(err); }
};

/**
 * Item 3: HR/Admin override to let an employee use their one-time
 * self-edit again — e.g. they made a genuine mistake, or a detail
 * changed (new phone number) before HR got around to updating it for
 * them. Without this the one-time lock would create real support burden.
 * HR/Admin only; logged as its own career event for traceability.
 */
const resetSelfEditLock = async (req, res, next) => {
  try {
    const scopeIds = await resolveScopeCompanyIds(req);
    const existing = await loadTargetEmployee(req, scopeIds, 'id, role, is_active, company_id');
    const targetId = existing.id;
    await assertMayChangeAccount(req, existing, { action: 'reset_self_edit_lock' });

    const { data, error } = await supabaseAdmin
      .from('employees')
      .update({ profile_self_edit_used: false })
      .eq('id', targetId)
      .select()
      .single();
    if (error) throw new BadRequestError(error.message);

    await supabaseAdmin.from('employee_career_events').insert({
      employee_id: targetId,
      company_id: getCompanyId(existing),
      event_type: 'note',
      note: `Self-edit lock reset by ${req.user.role}${req.body?.reason ? `: ${req.body.reason}` : ''}`,
      effective_date: new Date().toISOString().slice(0, 10),
      created_by: req.user.id,
    }).then(({ error: logError }) => {
      if (logError) logger.warn('Failed to log self-edit-lock reset', { employeeId: targetId, error: logError.message });
    });

    successResponse(res, 'Self-edit lock reset — employee can edit their profile once more', omitSensitive(data, ['password_hash']));
  } catch (err) { next(err); }
};

/** Same self/manager/HR-Admin visibility check `getById` already applies to this profile. */
async function assertCanViewCareerEvents(req, employee) {
  const isSelf = sameId(req.user.id, employee.id);
  const isPrivileged = ['hr', 'admin'].includes(req.user.role);
  const isManager = req.user.role === 'manager' && sameId(employee.manager_id, req.user.id);
  if (!isSelf && !isPrivileged && !isManager) {
    throw new ForbiddenError('Not authorized to view this employee');
  }
}

const listCareerEvents = async (req, res, next) => {
  try {
    const scopeIds = await resolveScopeCompanyIds(req);
    const employee = await findEmployeeByRef(
      req.params.id,
      scopeIds,
      'id, company_id, manager_id, designation, date_of_joining, created_at',
    );
    if (!employee) throw new NotFoundError('Employee not found');

    await assertCanViewCareerEvents(req, employee);
    if (!sameId(req.user.id, employee.id)) await assertEmployeesPermission(req, 'view', employee);

    // Belt-and-suspenders on top of the employee-scope check above: events
    // are also filtered by the employee's own company_id, so a row stamped
    // to a previous employer (before a re-parent) never surfaces here even
    // if some future change to employee-scoping logic had a bug.
    let data = [];
    {
      const { data: rows, error } = await supabaseAdmin
        .from('employee_career_events')
        .select('*')
        .eq('employee_id', employee.id)
        .eq('company_id', getCompanyId(employee))
        .order('effective_date', { ascending: false })
        .order('created_at', { ascending: false });
      if (error) {
        // Migration 20260826_employee_career_events.sql not applied yet in
        // this environment (whole table, not just a column, so this is a
        // "relation does not exist" error) — fall back to the pre-migration
        // shape (synthetic "joined" event only) instead of a hard 400.
        if (!/relation .*employee_career_events.* does not exist/i.test(error.message || '')) {
          throw new BadRequestError(error.message);
        }
        logger.warn('employee_career_events table missing — falling back to synthetic-only career timeline', {
          employeeId: employee.id,
        });
      } else {
        data = rows;
      }
    }

    // The from/to salary/bank values are only ever used to compute whether a
    // change happened (logCareerEvents) — the UI intentionally shows a
    // generic "updated" line for both and never reads these values.
    // Stripping them here (not just in the UI) means the real figures are
    // never on the wire for this endpoint at all, matching the Payroll
    // module's own boundary that career/timeline views are not a salary/
    // bank-details disclosure surface.
    const MASKED_CAREER_EVENT_TYPES = new Set(['salary_change', 'bank_change']);
    const maskedEvents = (data || []).map((ev) => (
      MASKED_CAREER_EVENT_TYPES.has(ev.event_type)
        ? { ...ev, from_value: null, to_value: null }
        : ev
    ));

    // Existing employees have no real "joined" row — synthesize it from the employee
    // record itself and merge chronologically with real (tracked) events. We never
    // attempt to backfill historical changes that predate this table.
    const joinedEvent = {
      id: `joined-${employee.id}`,
      employee_id: employee.id,
      company_id: employee.company_id,
      event_type: 'joined',
      from_value: null,
      to_value: employee.designation || null,
      effective_date: (employee.date_of_joining || employee.created_at || '').slice(0, 10) || null,
      note: null,
      created_by: null,
      created_at: employee.created_at || employee.date_of_joining || null,
      synthetic: true,
    };

    const merged = [...maskedEvents, joinedEvent].sort((a, b) => {
      const dateDiff = new Date(b.effective_date || 0) - new Date(a.effective_date || 0);
      if (dateDiff !== 0) return dateDiff;
      return new Date(b.created_at || 0) - new Date(a.created_at || 0);
    });

    successResponse(res, 'Career events fetched', merged);
  } catch (err) { next(err); }
};

const addCareerNote = async (req, res, next) => {
  try {
    const scopeIds = await resolveScopeCompanyIds(req);
    const employee = await findEmployeeByRef(req.params.id, scopeIds, 'id, company_id');
    if (!employee) throw new NotFoundError('Employee not found');

    // HR/Admin only — matches how other free-form additions to an employee's
    // record (create, deactivate, remove) are gated in this controller.
    if (!['hr', 'admin'].includes(req.user.role)) {
      throw new ForbiddenError('Only HR or Admin can add a career note');
    }
    await assertEmployeesPermission(req, 'edit', employee);

    const note = String(req.body.note || '').trim();
    if (!note) throw new BadRequestError('Note text is required');

    const { data, error } = await supabaseAdmin
      .from('employee_career_events')
      .insert({
        employee_id: employee.id,
        company_id: getCompanyId(employee),
        event_type: 'note',
        note,
        effective_date: req.body.effective_date || new Date().toISOString().slice(0, 10),
        created_by: req.user.id,
      })
      .select()
      .single();
    if (error) throw new BadRequestError(error.message);

    successResponse(res, 'Career note added', data, null, 201);
  } catch (err) { next(err); }
};

module.exports = {
  create, getAll, getById, update, uploadPhoto, offboard, permanentlyErase, getTeam, deactivate,
  listCareerEvents, addCareerNote, resetSelfEditLock,
};
