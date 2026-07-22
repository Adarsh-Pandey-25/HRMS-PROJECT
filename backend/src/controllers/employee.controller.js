const { supabaseAdmin } = require('../config/supabase');
const authService = require('../services/auth.service');
const { successResponse, paginate, buildMeta, omitSensitive, generateDefaultPassword } = require('../utils/helpers');
const { BadRequestError, NotFoundError, ConflictError, ForbiddenError } = require('../utils/errors');
const { getCompanyId, withCompanyId, companyIdFields } = require('../utils/tenant');
const { employeeBelongsToCompany } = require('../services/tenant.service');
const { allocateNextEmployeeCode } = require('../services/employeeCode.service');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function findEmployeeByRef(ref, companyId, select = '*') {
  const isUuid = UUID_RE.test(String(ref || ''));
  let query = supabaseAdmin.from('employees').select(select);
  query = isUuid ? query.eq('id', ref) : query.eq('employee_code', ref).eq('company_id', companyId);
  const { data, error } = await query.maybeSingle();
  if (error) throw new BadRequestError(error.message);
  if (!data || !employeeBelongsToCompany(data, companyId)) return null;
  return data;
}

const create = async (req, res, next) => {
  try {
    const companyId = req.user.company_id || getCompanyId(req.user);
    const tempPassword = generateDefaultPassword(req.body.first_name, req.body.last_name);
    const passwordHash = await authService.hashPassword(tempPassword);

    const { data: existing } = await supabaseAdmin
      .from('employees')
      .select('id')
      .eq('email', req.body.email)
      .maybeSingle();

    if (existing) throw new ConflictError('Email already exists');

    const { password_hash: _ph, address, company_id: _cid, employee_code: _code, ...body } = req.body;
    const employeeCode = await allocateNextEmployeeCode(companyId);
    const { data, error } = await supabaseAdmin
      .from('employees')
      .insert({
        ...body,
        employee_code: employeeCode,
        password_hash: passwordHash,
        ...companyIdFields(companyId, address),
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
    const companyId = req.user.company_id || getCompanyId(req.user);
    const { page, limit, offset } = paginate(req.query);

    let query = supabaseAdmin
      .from('employees')
      .select('*, manager:manager_id(id, first_name, last_name)', { count: 'exact' })
      .eq('company_id', companyId)
      .neq('role', 'admin')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (req.query.department) query = query.eq('department', req.query.department);
    if (req.query.role) query = query.eq('role', req.query.role);
    if (req.query.is_active !== undefined) query = query.eq('is_active', req.query.is_active === 'true');

    const { data, error, count } = await query;
    if (error) throw new BadRequestError(error.message);

    const sanitized = (data || []).map((e) => omitSensitive(e, ['password_hash']));
    successResponse(res, 'Employees fetched', sanitized, buildMeta(page, limit, count || 0));
  } catch (err) { next(err); }
};

const getById = async (req, res, next) => {
  try {
    const companyId = req.user.company_id || getCompanyId(req.user);
    const data = await findEmployeeByRef(
      req.params.id,
      companyId,
      '*, manager:manager_id(id, first_name, last_name, email)',
    );

    if (!data) throw new NotFoundError('Employee not found');

    const isSelf = req.user.id === data.id;
    const isPrivileged = ['hr', 'admin'].includes(req.user.role);
    const isManager = req.user.role === 'manager' && data.manager_id === req.user.id;

    if (!isSelf && !isPrivileged && !isManager) {
      return successResponse(res, 'Employee fetched', omitSensitive(data, ['password_hash', 'bank_details', 'salary_details']));
    }

    successResponse(res, 'Employee fetched', omitSensitive(data, ['password_hash']));
  } catch (err) { next(err); }
};

const update = async (req, res, next) => {
  try {
    const companyId = req.user.company_id || getCompanyId(req.user);
    const { data: existing } = await supabaseAdmin
      .from('employees')
      .select('id, address')
      .eq('id', req.params.id)
      .maybeSingle();
    if (!existing || !employeeBelongsToCompany(existing, companyId)) {
      throw new NotFoundError('Employee not found');
    }

    const isSelf = req.user.id === req.params.id;
    const isPrivileged = ['hr', 'admin'].includes(req.user.role);

    if (!isSelf && !isPrivileged) {
      throw new ForbiddenError('Not authorized to update this employee');
    }

    const allowedFields = isPrivileged
      ? { ...req.body }
      : {
          phone: req.body.phone,
          address: req.body.address,
          emergency_contact: req.body.emergency_contact,
          profile_picture: req.body.profile_picture,
        };

    delete allowedFields.password_hash;
    delete allowedFields.email;
    if (allowedFields.address !== undefined) {
      allowedFields.address = withCompanyId(allowedFields.address, companyId);
      allowedFields.company_id = companyId;
    } else if (isPrivileged) {
      // Never allow moving an employee to another company via API
      delete allowedFields.company_id;
    }

    const { data, error } = await supabaseAdmin
      .from('employees')
      .update(allowedFields)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw new BadRequestError(error.message);
    successResponse(res, 'Employee updated', omitSensitive(data, ['password_hash']));
  } catch (err) { next(err); }
};

const remove = async (req, res, next) => {
  try {
    const companyId = req.user.company_id || getCompanyId(req.user);
    const { data: existing } = await supabaseAdmin
      .from('employees')
      .select('id, address')
      .eq('id', req.params.id)
      .maybeSingle();
    if (!existing || !employeeBelongsToCompany(existing, companyId)) {
      throw new NotFoundError('Employee not found');
    }
    await supabaseAdmin.from('employees').delete().eq('id', req.params.id);
    successResponse(res, 'Employee deleted');
  } catch (err) { next(err); }
};

const getTeam = async (req, res, next) => {
  try {
    const companyId = req.user.company_id || getCompanyId(req.user);
    const managerId = req.params.managerId || req.user.id;
    const { data, error } = await supabaseAdmin
      .from('employees')
      .select('id, employee_code, first_name, last_name, email, department, designation, is_active, address')
      .eq('manager_id', managerId)
      .eq('is_active', true);

    if (error) throw new BadRequestError(error.message);
    const scoped = (data || []).filter((e) => employeeBelongsToCompany(e, companyId));
    successResponse(res, 'Team fetched', scoped.map((e) => {
      const { address, ...rest } = e;
      return rest;
    }));
  } catch (err) { next(err); }
};

const deactivate = async (req, res, next) => {
  try {
    const companyId = req.user.company_id || getCompanyId(req.user);
    const { data: existing } = await supabaseAdmin
      .from('employees')
      .select('id, address')
      .eq('id', req.params.id)
      .maybeSingle();
    if (!existing || !employeeBelongsToCompany(existing, companyId)) {
      throw new NotFoundError('Employee not found');
    }

    const { data, error } = await supabaseAdmin
      .from('employees')
      .update({ is_active: false })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw new BadRequestError(error.message);
    await supabaseAdmin.from('refresh_tokens').delete().eq('employee_id', req.params.id);
    successResponse(res, 'Employee deactivated', omitSensitive(data, ['password_hash']));
  } catch (err) { next(err); }
};

module.exports = {
  create, getAll, getById, update, remove, getTeam, deactivate,
};
