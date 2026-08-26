const { supabaseAdmin } = require('../config/supabase');
const authService = require('../services/auth.service');
const { successResponse, paginate, buildMeta, omitSensitive, generateDefaultPassword } = require('../utils/helpers');
const { BadRequestError, NotFoundError, ConflictError, ForbiddenError } = require('../utils/errors');
const { getCompanyId, withCompanyId, companyIdFields } = require('../utils/tenant');
const {
  employeeBelongsToCompany,
  getOrgCompanyIds,
  isCompanyInOrg,
  getCompanyById,
} = require('../services/tenant.service');
const { allocateNextEmployeeCode } = require('../services/employeeCode.service');
const { uploadProfilePicture, getSignedUrl, STORAGE_BUCKETS } = require('../services/storage.service');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Employee fields that auto-log a career event when HR/Admin changes them via update(). */
const CAREER_TRACKED_FIELDS = {
  designation: 'designation_change',
  department: 'department_change',
  manager_id: 'manager_change',
  salary_details: 'salary_change',
};

const stringifyCareerValue = (val) => {
  if (val === null || val === undefined || val === '') return null;
  return typeof val === 'object' ? JSON.stringify(val) : String(val);
};

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
    const changed = field === 'salary_details'
      ? JSON.stringify(fromVal || {}) !== JSON.stringify(toVal || {})
      : String(fromVal ?? '') !== String(toVal ?? '');
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
    const { data, error } = await supabaseAdmin
      .from('employees')
      .insert({
        ...fields,
        email: req.body.email,
        employee_code: employeeCode,
        password_hash: passwordHash,
        must_change_password: true,
        ...companyIdFields(companyId, fields.address),
      })
      .select()
      .single();

    if (error) throw new BadRequestError(error.message);

    const employee = omitSensitive(data, ['password_hash']);
    try {
      const { welcomeEmail } = require('../services/email.service');
      await welcomeEmail(employee, tempPassword);
    } catch {
      /* email is best-effort; do not fail create */
    }
    // Never return tempPassword in the API body — credentials go by email only.
    successResponse(res, 'Employee created. Temporary password sent by email.', { employee }, null, 201);
  } catch (err) { next(err); }
};

const getAll = async (req, res, next) => {
  try {
    const scopeIds = await resolveScopeCompanyIds(req);
    const { page, limit, offset } = paginate(req.query);

    const scopeIdSet = new Set((scopeIds || []).map(String));

    let query = supabaseAdmin
      .from('employees')
      .select(
        '*, manager:manager_id(id, first_name, last_name), company:company_id(id, name, slug)',
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

    successResponse(res, 'Employee fetched', {
      ...omitSensitive(data, ['password_hash']),
      profile_picture_url: profilePictureUrl,
    });
  } catch (err) { next(err); }
};

const update = async (req, res, next) => {
  try {
    const scopeIds = await resolveScopeCompanyIds(req);
    const { data: existing } = await supabaseAdmin
      .from('employees')
      .select('id, address, company_id, designation, department, manager_id, salary_details')
      .eq('id', req.params.id)
      .maybeSingle();
    if (!existing || !scopeIds.map(String).includes(String(getCompanyId(existing)))) {
      throw new NotFoundError('Employee not found');
    }

    const isSelf = req.user.id === req.params.id;
    const isPrivileged = ['hr', 'admin'].includes(req.user.role);

    if (!isSelf && !isPrivileged) {
      throw new ForbiddenError('Not authorized to update this employee');
    }

    const allowedFields = isPrivileged
      ? pickEmployeeFields(req.body)
      : {
          phone: req.body.phone,
          address: req.body.address,
          emergency_contact: req.body.emergency_contact,
          profile_picture: req.body.profile_picture,
        };

    if (isPrivileged && req.body.role !== undefined) {
      allowedFields.role = resolveAssignableRole(req.user.role, req.body.role);
    }

    delete allowedFields.password_hash;
    delete allowedFields.email;
    delete allowedFields.companyId;

    // Admin / HR may move employee within org (parent ↔ child)
    let stampCompanyId = getCompanyId(existing);
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

    const { data, error } = await supabaseAdmin
      .from('employees')
      .update(allowedFields)
      .eq('id', req.params.id)
      .select()
      .single();

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

const remove = async (req, res, next) => {
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
    await supabaseAdmin.from('employees').delete().eq('id', req.params.id);
    successResponse(res, 'Employee deleted');
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
    successResponse(res, 'Employee deactivated', omitSensitive(data, ['password_hash']));
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

    const { data, error } = await supabaseAdmin
      .from('employee_career_events')
      .select('*')
      .eq('employee_id', employee.id)
      .order('effective_date', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) throw new BadRequestError(error.message);

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

    const merged = [...(data || []), joinedEvent].sort((a, b) => {
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
  create, getAll, getById, update, uploadPhoto, remove, getTeam, deactivate,
  listCareerEvents, addCareerNote,
};
