const { supabaseAdmin } = require('../config/supabase');
const authService = require('../services/auth.service');
const { successResponse, paginate, buildMeta, omitSensitive, generateEmployeeCode, generateDefaultPassword } = require('../utils/helpers');
const { BadRequestError, NotFoundError, ConflictError, ForbiddenError } = require('../utils/errors');

const create = async (req, res, next) => {
  try {
    const tempPassword = generateDefaultPassword(req.body.first_name, req.body.last_name);
    const passwordHash = await authService.hashPassword(tempPassword);

    const { data: existing } = await supabaseAdmin
      .from('employees')
      .select('id')
      .eq('email', req.body.email)
      .single();

    if (existing) throw new ConflictError('Email already exists');

    const { data, error } = await supabaseAdmin
      .from('employees')
      .insert({
        ...req.body,
        employee_code: req.body.employee_code || generateEmployeeCode(),
        password_hash: passwordHash,
      })
      .select()
      .single();

    if (error) throw new BadRequestError(error.message);

    const employee = omitSensitive(data, ['password_hash']);
    successResponse(res, 'Employee created', { employee, tempPassword }, null, 201);
  } catch (err) { next(err); }
};

const getAll = async (req, res, next) => {
  try {
    const { page, limit, offset } = paginate(req.query);
    let query = supabaseAdmin
      .from('employees')
      .select('*, manager:manager_id(id, first_name, last_name)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (req.query.department) query = query.eq('department', req.query.department);
    if (req.query.role) query = query.eq('role', req.query.role);
    if (req.query.is_active !== undefined) query = query.eq('is_active', req.query.is_active === 'true');

    const { data, error, count } = await query;
    if (error) throw new BadRequestError(error.message);

    const sanitized = (data || []).map((e) => omitSensitive(e, ['password_hash']));
    successResponse(res, 'Employees fetched', sanitized, buildMeta(page, limit, count));
  } catch (err) { next(err); }
};

const getById = async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('employees')
      .select('*, manager:manager_id(id, first_name, last_name, email)')
      .eq('id', req.params.id)
      .single();

    if (error || !data) throw new NotFoundError('Employee not found');

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
    const isSelf = req.user.id === req.params.id;
    const isPrivileged = ['hr', 'admin'].includes(req.user.role);

    if (!isSelf && !isPrivileged) {
      throw new ForbiddenError('Not authorized to update this employee');
    }

    const allowedFields = isPrivileged
      ? req.body
      : {
          phone: req.body.phone,
          address: req.body.address,
          emergency_contact: req.body.emergency_contact,
          profile_picture: req.body.profile_picture,
        };

    delete allowedFields.password_hash;
    delete allowedFields.email;

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
    await supabaseAdmin.from('employees').delete().eq('id', req.params.id);
    successResponse(res, 'Employee deleted');
  } catch (err) { next(err); }
};

const getTeam = async (req, res, next) => {
  try {
    const managerId = req.params.managerId || req.user.id;
    const { data, error } = await supabaseAdmin
      .from('employees')
      .select('id, employee_code, first_name, last_name, email, department, designation, is_active')
      .eq('manager_id', managerId)
      .eq('is_active', true);

    if (error) throw new BadRequestError(error.message);
    successResponse(res, 'Team fetched', data);
  } catch (err) { next(err); }
};

const deactivate = async (req, res, next) => {
  try {
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
