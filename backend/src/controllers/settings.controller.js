const settingsService = require('../services/settings.service');
const { supabaseAdmin } = require('../config/supabase');
const { successResponse } = require('../utils/helpers');
const { BadRequestError, NotFoundError } = require('../utils/errors');
const { LEAVE_TYPES } = require('../utils/constants');

const normalizeLeavePolicy = (policy) => {
  if (!Array.isArray(policy)) throw new BadRequestError('policy array is required');
  if (!policy.length) throw new BadRequestError('policy must include at least one leave type');

  const seen = new Set();
  return policy.map((item, idx) => {
    const code = String(item?.code || '').trim().toUpperCase();
    if (!code) throw new BadRequestError(`policy[${idx}].code is required`);
    if (!LEAVE_TYPES.includes(code)) {
      throw new BadRequestError(
        `Invalid leave code "${code}". Allowed: ${LEAVE_TYPES.join(', ')}`
      );
    }
    if (seen.has(code)) throw new BadRequestError(`Duplicate leave code "${code}"`);
    seen.add(code);
    return {
      ...item,
      code,
      name: item.name || code,
      allocation: Math.max(0, Number(item.allocation || 0)),
      active: item.active !== false,
    };
  });
};

const getRolePermissions = async (req, res, next) => {
  try {
    const value = await settingsService.getSetting('role_permissions', null);
    successResponse(res, 'Role permissions fetched', { key: 'role_permissions', value });
  } catch (err) {
    next(err);
  }
};

const getAll = async (req, res, next) => {
  try {
    await settingsService.ensureCache(true);
    const { data, error } = await supabaseAdmin
      .from('system_settings')
      .select('key,value,updated_at,updated_by')
      .order('key', { ascending: true });

    if (error) throw new BadRequestError(error.message);
    successResponse(res, 'System settings fetched', data);
  } catch (err) {
    next(err);
  }
};

const getByKey = async (req, res, next) => {
  try {
    const key = req.params.key;
    const { data, error } = await supabaseAdmin
      .from('system_settings')
      .select('key,value,updated_at,updated_by')
      .eq('key', key)
      .single();

    if (error || !data) throw new NotFoundError('Setting not found');
    successResponse(res, 'Setting fetched', data);
  } catch (err) {
    next(err);
  }
};

const updateKey = async (req, res, next) => {
  try {
    const key = req.params.key;
    if (typeof req.body.value === 'undefined') {
      throw new BadRequestError('value is required');
    }

    const { data, error } = await settingsService.setSetting(key, req.body.value, req.user.id);
    if (error) throw new BadRequestError(error.message);

    successResponse(res, 'Setting updated', data);
  } catch (err) {
    next(err);
  }
};

// Payroll Components (Dynamic Salary Structure)
const getPayrollComponents = async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('payroll_components')
      .select('*')
      .order('display_order', { ascending: true });
    if (error) throw new BadRequestError(error.message);
    successResponse(res, 'Payroll components fetched', data);
  } catch (err) { next(err); }
};

const createPayrollComponent = async (req, res, next) => {
  try {
    const payload = req.body || {};
    const { data, error } = await supabaseAdmin
      .from('payroll_components')
      .insert({
        type: payload.type,
        name: payload.name,
        is_fixed: Boolean(payload.is_fixed),
        fixed_amount: payload.fixed_amount ?? null,
        target_field: payload.target_field ?? null,
        operator: payload.operator ?? null,
        operand_field: payload.operand_field ?? null,
        operand_value: payload.operand_value ?? null,
        output_field: payload.output_field ?? null,
        display_order: payload.display_order ?? 0,
        is_active: payload.is_active !== false,
      })
      .select()
      .single();
    if (error) throw new BadRequestError(error.message);
    successResponse(res, 'Payroll component created', data, null, 201);
  } catch (err) { next(err); }
};

const updatePayrollComponent = async (req, res, next) => {
  try {
    const payload = req.body || {};
    const patch = { updated_at: new Date().toISOString() };
    if (payload.type !== undefined) patch.type = payload.type;
    if (payload.name !== undefined) patch.name = payload.name;
    if (payload.is_fixed !== undefined) patch.is_fixed = Boolean(payload.is_fixed);
    if (payload.fixed_amount !== undefined) patch.fixed_amount = payload.fixed_amount;
    if (payload.target_field !== undefined) patch.target_field = payload.target_field;
    if (payload.operator !== undefined) patch.operator = payload.operator;
    if (payload.operand_field !== undefined) patch.operand_field = payload.operand_field;
    if (payload.operand_value !== undefined) patch.operand_value = payload.operand_value;
    if (payload.output_field !== undefined) patch.output_field = payload.output_field;
    if (payload.display_order !== undefined) patch.display_order = payload.display_order;
    if (payload.is_active !== undefined) patch.is_active = payload.is_active !== false;

    const { data, error } = await supabaseAdmin
      .from('payroll_components')
      .update(patch)
      .eq('id', req.params.id)
      .select()
      .maybeSingle();
    if (error) throw new BadRequestError(error.message);
    if (!data) throw new NotFoundError('Payroll component not found');
    successResponse(res, 'Payroll component updated', data);
  } catch (err) { next(err); }
};

const deletePayrollComponent = async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('payroll_components')
      .delete()
      .eq('id', req.params.id)
      .select('id')
      .maybeSingle();
    if (error) throw new BadRequestError(error.message);
    if (!data) throw new NotFoundError('Payroll component not found');
    successResponse(res, 'Payroll component deleted');
  } catch (err) { next(err); }
};

// Leave Policy (Editable leave allocations)
const getLeaveAllocations = async (req, res, next) => {
  try {
    await settingsService.ensureCache(false);
    const value = await settingsService.getSetting('leave_allocations', null);
    successResponse(res, 'Leave allocations fetched', value);
  } catch (err) { next(err); }
};

const updateLeaveAllocations = async (req, res, next) => {
  try {
    const allocations = req.body?.allocations;
    if (!allocations || typeof allocations !== 'object') {
      throw new BadRequestError('allocations object is required');
    }
    const { data, error } = await settingsService.setSetting('leave_allocations', allocations, req.user.id);
    if (error) throw new BadRequestError(error.message);
    successResponse(res, 'Leave allocations updated', data);
  } catch (err) { next(err); }
};

// Leave Policy v2 (supports enable/disable + custom display name per type)
const getLeavePolicy = async (req, res, next) => {
  try {
    await settingsService.ensureCache(false);
    const value = await settingsService.getSetting('leave_policy', null);
    successResponse(res, 'Leave policy fetched', value);
  } catch (err) { next(err); }
};

const updateLeavePolicy = async (req, res, next) => {
  try {
    const policy = normalizeLeavePolicy(req.body?.policy);

    const { data, error } = await settingsService.setSetting('leave_policy', policy, req.user.id);
    if (error) throw new BadRequestError(error.message);
    successResponse(res, 'Leave policy updated', data);
  } catch (err) { next(err); }
};

const applyLeavePolicyToAll = async (req, res, next) => {
  try {
    const year = parseInt(req.query.year, 10);
    if (!year) throw new BadRequestError('year query param is required');

    const rawPolicy = await settingsService.getSetting('leave_policy', null);
    const policy = normalizeLeavePolicy(rawPolicy);

    const { data: employees, error: empErr } = await supabaseAdmin
      .from('employees')
      .select('id')
      .eq('is_active', true);
    if (empErr) throw new BadRequestError(empErr.message);
    const employeeIds = (employees || []).map((e) => e.id);

    for (const item of policy) {
      const code = item.code;
      const allocation = Number(item.allocation || 0);
      const active = item.active !== false;

      const { data: existing, error: exErr } = await supabaseAdmin
        .from('leave_balances')
        .select('employee_id')
        .eq('year', year)
        .eq('leave_type', code);
      if (exErr) throw new BadRequestError(exErr.message);
      const existingSet = new Set((existing || []).map((r) => r.employee_id));
      const missing = employeeIds.filter((id) => !existingSet.has(id));
      if (missing.length) {
        const rows = missing.map((id) => ({
          employee_id: id,
          year,
          leave_type: code,
          total_allocated: active ? allocation : 0,
          used: 0,
          encashed: 0,
        }));
        const { error: insErr } = await supabaseAdmin.from('leave_balances').insert(rows);
        if (insErr) throw new BadRequestError(insErr.message);
      }

      const { error: updErr } = await supabaseAdmin
        .from('leave_balances')
        .update({ total_allocated: active ? allocation : 0 })
        .eq('year', year)
        .eq('leave_type', code);
      if (updErr) throw new BadRequestError(updErr.message);
    }

    successResponse(res, 'Leave policy applied to all employees', { year });
  } catch (err) { next(err); }
};

// Apply leave allocations to ALL employees (bulk update leave_balances for a year)
const applyLeaveAllocationsToAll = async (req, res, next) => {
  try {
    const year = parseInt(req.query.year, 10);
    if (!year) throw new BadRequestError('year query param is required');

    const allocations = await settingsService.getSetting('leave_allocations', null);
    if (!allocations || typeof allocations !== 'object') {
      throw new BadRequestError('Leave allocations are not configured yet');
    }

    // Update existing balances
    const types = Object.keys(allocations);
    for (const t of types) {
      await supabaseAdmin
        .from('leave_balances')
        .update({ total_allocated: Number(allocations[t] || 0) })
        .eq('year', year)
        .eq('leave_type', t);
    }

    successResponse(res, 'Leave allocations applied to all employees', { year, types });
  } catch (err) { next(err); }
};

module.exports = {
  getAll,
  getByKey,
  updateKey,
  getRolePermissions,
  getPayrollComponents,
  createPayrollComponent,
  updatePayrollComponent,
  deletePayrollComponent,
  getLeaveAllocations,
  updateLeaveAllocations,
  applyLeaveAllocationsToAll,
  getLeavePolicy,
  updateLeavePolicy,
  applyLeavePolicyToAll,
};

