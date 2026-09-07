const { supabaseAdmin } = require('../config/supabase');
const authService = require('../services/auth.service');
const { successResponse, paginate, buildMeta, omitSensitive, generateDefaultPassword, isMissingColumnError } = require('../utils/helpers');
const { BadRequestError, NotFoundError, ConflictError, ForbiddenError } = require('../utils/errors');
const { getCompanyId, withCompanyId, companyIdFields } = require('../utils/tenant');
const {
  employeeBelongsToCompany,
  getOrgCompanyIds,
  isCompanyInOrg,
  getCompanyById,
} = require('../services/tenant.service');
const { allocateNextEmployeeCode } = require('../services/employeeCode.service');
const { uploadProfilePicture, getSignedUrl, STORAGE_BUCKETS, deleteEmployeeFolder } = require('../services/storage.service');
const logger = require('../utils/logger');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

const resolveAssignableRole = (actorRole, requestedRole, fallback = 'employee') => {
  const allowed = actorRole === 'admin'
    ? ['admin', 'hr', 'manager', 'employee']
    : ['hr', 'manager', 'employee'];
  if (!requestedRole) return fallback;
  if (!allowed.includes(requestedRole)) {
    throw new ForbiddenError(
      actorRole === 'admin'
        ? 'Invalid role'
        : 'HR cannot assign the admin role',
    );
  }
  return requestedRole;
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

  const isUuid = UUID_RE.test(String(ref || ''));
  let query = supabaseAdmin
    .from('employees')
    .select(select)
    .in('company_id', scopeIds);

  if (isUuid) {
    query = query.eq('id', ref);
  } else {
    // Employee codes restart per company (EMP001…) — may match multiple rows in org scope
    query = query.eq('employee_code', ref).limit(5);
  }

  const { data, error } = await query;
  if (error) throw new BadRequestError(error.message);

  const rows = Array.isArray(data) ? data : (data ? [data] : []);
  if (!rows.length) return null;

  // Prefer exact UUID match; for codes take first in-scope row
  if (isUuid) {
    return rows.find((r) => String(r.id) === String(ref)) || rows[0];
  }
  return rows[0];
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

    const fields = pickEmployeeFields(req.body);
    fields.role = resolveAssignableRole(req.user.role, fields.role || req.body.role, 'employee');
    const employeeCode = await allocateNextEmployeeCode(companyId);
    // `source: 'bulk_import'` is set by the frontend's CSV-import loop
    // (BulkImportPanel.jsx) so this one endpoint — the only employee-create
    // path that exists — can tell "added one at a time" apart from
    // "migrated via bulk import" and send the right template. Anything
    // else (including the normal Add Employee form, which never sends it)
    // falls through to the regular welcome email.
    const isBulkImport = req.body.source === 'bulk_import';
    const expiryHours = 48;
    const insertFields = {
      ...fields,
      email: req.body.email,
      employee_code: employeeCode,
      password_hash: passwordHash,
      must_change_password: true,
      temp_password_expires_at: new Date(Date.now() + expiryHours * 60 * 60 * 1000).toISOString(),
      ...companyIdFields(companyId, fields.address),
    };
    let { data, error } = await supabaseAdmin.from('employees').insert(insertFields).select().single();
    if (error && isMissingColumnError(error.message, 'temp_password_expires_at')) {
      const { temp_password_expires_at, ...withoutExpiry } = insertFields;
      ({ data, error } = await supabaseAdmin.from('employees').insert(withoutExpiry).select().single());
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
    try {
      const { welcomeEmail, bulkImportEmail } = require('../services/email.service');
      if (isBulkImport) {
        await bulkImportEmail(employee, tempPassword, { expiryHours });
      } else {
        await welcomeEmail(employee, tempPassword);
      }
    } catch {
      /* email is best-effort; do not fail create */
    }
    require('../services/webhook.service').dispatchWebhookEvent(companyId, 'employee.created', {
      employeeId: employee.id, employeeCode: employee.employee_code, firstName: employee.first_name,
      lastName: employee.last_name, email: employee.email, role: employee.role, department: employee.department,
    });
    // Never return tempPassword in the API body — credentials go by email only.
    successResponse(res, 'Employee created. Temporary password sent by email.', { employee }, null, 201);
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

    const sanitized = (data || []).map((e) => omitSensitive(e, ['password_hash']));
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

    const isSelf = req.user.id === data.id;
    const isPrivileged = ['hr', 'admin'].includes(req.user.role);
    const isManager = req.user.role === 'manager' && data.manager_id === req.user.id;

    // Employees may only open their own profile; managers see direct reports; HR/Admin see all.
    if (!isSelf && !isPrivileged && !isManager) {
      throw new ForbiddenError('Not authorized to view this employee');
    }

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
    let { data: existing, error: existingError } = await supabaseAdmin
      .from('employees')
      .select('id, address, company_id, designation, department, manager_id, salary_details, bank_details, profile_self_edit_used')
      .eq('id', req.params.id)
      .maybeSingle();
    if (existingError && isMissingColumnError(existingError.message, 'profile_self_edit_used')) {
      ({ data: existing, error: existingError } = await supabaseAdmin
        .from('employees')
        .select('id, address, company_id, designation, department, manager_id, salary_details, bank_details')
        .eq('id', req.params.id)
        .maybeSingle());
    }
    if (existingError) throw new BadRequestError(existingError.message);
    if (!existing || !scopeIds.map(String).includes(String(getCompanyId(existing)))) {
      throw new NotFoundError('Employee not found');
    }

    const isSelf = req.user.id === req.params.id;
    const isPrivileged = ['hr', 'admin'].includes(req.user.role);

    if (!isSelf && !isPrivileged) {
      throw new ForbiddenError('Not authorized to update this employee');
    }

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
          phone: req.body.phone,
          address: req.body.address,
          emergency_contact: req.body.emergency_contact,
          profile_picture: req.body.profile_picture,
        };

    // Item 2: bank_details may be SET by the employee themselves only
    // while currently null/unset (first-time entry during onboarding) —
    // once a value exists, changing it is HR/Admin-only (N-01's original
    // reasoning: redirecting your own salary payments). Silently dropped
    // rather than erroring the whole request, so other fields in the same
    // submission still go through.
    if (isNarrowSelfEdit && req.body.bank_details !== undefined) {
      const hasExistingBank = existing.bank_details && Object.keys(existing.bank_details).length > 0;
      if (!hasExistingBank) {
        allowedFields.bank_details = req.body.bank_details;
      }
    }

    if (isPrivileged && req.body.role !== undefined) {
      allowedFields.role = resolveAssignableRole(req.user.role, req.body.role);
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
      // bank_details: left alone here when the item 2 first-time-set branch
      // above already populated it (isNarrowSelfEdit + no existing value) —
      // otherwise stripped exactly as before.
      if (!(isNarrowSelfEdit && allowedFields.bank_details !== undefined)) {
        delete allowedFields.bank_details;
      }
      delete allowedFields.is_active;
      delete allowedFields.manager_id;
      delete allowedFields.designation;
      delete allowedFields.department;
      delete allowedFields.role;
    }

    // Admin / HR may move employee within org (parent ↔ child)
    const previousCompanyId = getCompanyId(existing);
    let stampCompanyId = previousCompanyId;
    if (
      isPrivileged
      && (req.user.role === 'admin' || req.user.role === 'hr')
      && (req.body.company_id || req.body.companyId)
    ) {
      stampCompanyId = await resolveTargetCompanyId(req, req.body.company_id || req.body.companyId);
      allowedFields.company_id = stampCompanyId;
    } else {
      delete allowedFields.company_id;
    }

    if (allowedFields.address !== undefined) {
      allowedFields.address = withCompanyId(allowedFields.address, stampCompanyId);
      allowedFields.company_id = stampCompanyId;
    } else if (allowedFields.company_id) {
      allowedFields.address = withCompanyId(existing.address, stampCompanyId);
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
      .eq('id', req.params.id)
      .select()
      .single();

    if (error && isNarrowSelfEdit && isMissingColumnError(error.message, 'profile_self_edit_used')) {
      delete allowedFields.profile_self_edit_used;
      ({ data, error } = await supabaseAdmin
        .from('employees')
        .update(allowedFields)
        .eq('id', req.params.id)
        .select()
        .single());
    }

    if (error) throw new BadRequestError(error.message);

    if (isPrivileged) {
      await logCareerEvents({
        employeeId: req.params.id,
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
        .eq('employee_id', req.params.id);
      if (mappingCleanupError) {
        logger.warn('Failed to purge device mappings after company transfer', {
          employeeId: req.params.id, error: mappingCleanupError.message,
        });
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
      targetId: req.params.id,
      afterState: allowedFields,
      ipAddress: req.ip,
    }).catch((e) => logger.warn('Audit log failed', { error: e.message }));

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
    const { data: existing } = await supabaseAdmin
      .from('employees')
      .select('id, company_id')
      .eq('id', req.params.id)
      .maybeSingle();
    if (!existing || !scopeIds.map(String).includes(String(getCompanyId(existing)))) {
      throw new NotFoundError('Employee not found');
    }

    const isSelf = req.user.id === req.params.id;
    const isPrivileged = ['hr', 'admin'].includes(req.user.role);
    if (!isSelf && !isPrivileged) {
      throw new ForbiddenError('Not authorized to update this employee\'s photo');
    }

    const { path } = await uploadProfilePicture(req.file, req.params.id);

    const { data, error } = await supabaseAdmin
      .from('employees')
      .update({ profile_picture: path })
      .eq('id', req.params.id)
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
    let { data: existing, error: existingError } = await supabaseAdmin
      .from('employees')
      .select('id, address, company_id, employment_status')
      .eq('id', req.params.id)
      .maybeSingle();
    if (existingError && isMissingOffboardColumn(existingError.message)) {
      ({ data: existing, error: existingError } = await supabaseAdmin
        .from('employees')
        .select('id, address, company_id')
        .eq('id', req.params.id)
        .maybeSingle());
    }
    if (existingError) throw new BadRequestError(existingError.message);
    if (!existing || !scopeIds.map(String).includes(String(getCompanyId(existing)))) {
      throw new NotFoundError('Employee not found');
    }
    if (existing.employment_status === 'offboarded') {
      throw new ConflictError('Employee is already offboarded');
    }

    const reason = req.body?.reason ? String(req.body.reason).trim() : null;
    const fullUpdate = {
      is_active: false,
      employment_status: 'offboarded',
      offboarded_at: new Date().toISOString(),
      offboarded_by: req.user.id,
    };

    let { data, error } = await supabaseAdmin
      .from('employees')
      .update(fullUpdate)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error && isMissingOffboardColumn(error.message)) {
      ({ data, error } = await supabaseAdmin
        .from('employees')
        .update({ is_active: false })
        .eq('id', req.params.id)
        .select()
        .single());
    }
    if (error) throw new BadRequestError(error.message);

    // Same redundant revocation path as deactivate() (audit finding N-12).
    await authService.bumpTokenVersion(req.params.id);

    await supabaseAdmin.from('employee_career_events').insert({
      employee_id: req.params.id,
      company_id: getCompanyId(existing),
      event_type: 'offboarded',
      note: reason,
      effective_date: new Date().toISOString().slice(0, 10),
      created_by: req.user.id,
    }).then(({ error: logError }) => {
      if (logError) logger.warn('Failed to log offboard career event', { employeeId: req.params.id, error: logError.message });
    });

    require('../services/auditLog.service').logAudit({
      companyId: getCompanyId(existing),
      actorId: req.user.id,
      actorRole: req.user.role,
      actionType: 'employee.offboard',
      targetType: 'employee',
      targetId: req.params.id,
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
      employeeId: req.params.id, reason, offboardedAt: fullUpdate.offboarded_at,
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
    let { data: existing, error: existingError } = await supabaseAdmin
      .from('employees')
      .select('id, address, company_id, employment_status, employee_code, first_name, last_name, email')
      .eq('id', req.params.id)
      .maybeSingle();
    if (existingError && isMissingOffboardColumn(existingError.message)) {
      ({ data: existing, error: existingError } = await supabaseAdmin
        .from('employees')
        .select('id, address, company_id, employee_code, first_name, last_name, email')
        .eq('id', req.params.id)
        .maybeSingle());
    }
    if (existingError) throw new BadRequestError(existingError.message);
    if (!existing || !scopeIds.map(String).includes(String(getCompanyId(existing)))) {
      throw new NotFoundError('Employee not found');
    }
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
      targetId: req.params.id,
      beforeState: { employeeCode: existing.employee_code, name: `${existing.first_name || ''} ${existing.last_name || ''}`.trim() },
      ipAddress: req.ip,
    }).catch((e) => logger.warn('Audit log failed', { error: e.message }));

    await Promise.all([
      deleteEmployeeFolder(STORAGE_BUCKETS.documents, req.params.id),
      deleteEmployeeFolder(STORAGE_BUCKETS.receipts, req.params.id),
      deleteEmployeeFolder(STORAGE_BUCKETS.profilePictures, req.params.id),
      deleteEmployeeFolder(STORAGE_BUCKETS.payslips, req.params.id),
    ]);
    await supabaseAdmin.from('employees').delete().eq('id', req.params.id);
    successResponse(res, 'Employee data permanently erased');
  } catch (err) { next(err); }
};

const getTeam = async (req, res, next) => {
  try {
    const scopeIds = await resolveScopeCompanyIds(req);
    const managerId = req.params.managerId || req.user.id;
    const isPrivileged = ['hr', 'admin'].includes(req.user.role);
    // Managers may only fetch their own reports; HR/Admin may query any manager.
    if (!isPrivileged && String(managerId) !== String(req.user.id)) {
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
    const { data: existing } = await supabaseAdmin
      .from('employees')
      .select('id, address, company_id')
      .eq('id', req.params.id)
      .maybeSingle();
    if (!existing || !scopeIds.map(String).includes(String(getCompanyId(existing)))) {
      throw new NotFoundError('Employee not found');
    }

    const { data, error } = await supabaseAdmin
      .from('employees')
      .update({ is_active: false })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw new BadRequestError(error.message);
    // Audit finding N-12: is_active already kills the session via
    // authenticate()'s live re-check, but bump token_version too for a
    // redundant, independent revocation path.
    await authService.bumpTokenVersion(req.params.id);
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
    const { data: existing } = await supabaseAdmin
      .from('employees')
      .select('id, company_id')
      .eq('id', req.params.id)
      .maybeSingle();
    if (!existing || !scopeIds.map(String).includes(String(getCompanyId(existing)))) {
      throw new NotFoundError('Employee not found');
    }

    const { data, error } = await supabaseAdmin
      .from('employees')
      .update({ profile_self_edit_used: false })
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw new BadRequestError(error.message);

    await supabaseAdmin.from('employee_career_events').insert({
      employee_id: req.params.id,
      company_id: getCompanyId(existing),
      event_type: 'note',
      note: `Self-edit lock reset by ${req.user.role}${req.body?.reason ? `: ${req.body.reason}` : ''}`,
      effective_date: new Date().toISOString().slice(0, 10),
      created_by: req.user.id,
    }).then(({ error: logError }) => {
      if (logError) logger.warn('Failed to log self-edit-lock reset', { employeeId: req.params.id, error: logError.message });
    });

    successResponse(res, 'Self-edit lock reset — employee can edit their profile once more', omitSensitive(data, ['password_hash']));
  } catch (err) { next(err); }
};

/** Same self/manager/HR-Admin visibility check `getById` already applies to this profile. */
async function assertCanViewCareerEvents(req, employee) {
  const isSelf = req.user.id === employee.id;
  const isPrivileged = ['hr', 'admin'].includes(req.user.role);
  const isManager = req.user.role === 'manager' && employee.manager_id === req.user.id;
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
