const settingsService = require('../services/settings.service');
const { supabaseAdmin } = require('../config/supabase');
const { uploadCompanyLogo, getSignedUrl, STORAGE_BUCKETS } = require('../services/storage.service');
const { successResponse } = require('../utils/helpers');
const { BadRequestError, NotFoundError } = require('../utils/errors');
const { LEAVE_TYPES } = require('../utils/constants');

const enrichCompanyProfileValue = async (value) => {
  if (!value || typeof value !== 'object') return value;
  const logoPath = value.logoPath || value.logo_path;
  if (!logoPath) return value;
  try {
    const logoUrl = await getSignedUrl(STORAGE_BUCKETS.documents, logoPath, 86400);
    return { ...value, logoPath, logoUrl };
  } catch {
    return value;
  }
};

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
    const companyId = req.user?.company_id || null;
    const value = await settingsService.getSetting('role_permissions', null, companyId);
    successResponse(res, 'Role permissions fetched', { key: 'role_permissions', value });
  } catch (err) {
    next(err);
  }
};

const getAll = async (req, res, next) => {
  try {
    const companyId = req.user.company_id;
    const { data, error } = await settingsService.listSettingsForCompany(companyId);
    if (error) throw new BadRequestError(error.message);
    const enriched = await Promise.all((data || []).map(async (row) => {
      if (row.key !== 'company_profile') return row;
      return { ...row, value: await enrichCompanyProfileValue(row.value) };
    }));
    successResponse(res, 'System settings fetched', enriched);
  } catch (err) {
    next(err);
  }
};

const getByKey = async (req, res, next) => {
  try {
    const key = req.params.key;
    const companyId = req.user.company_id;
    let value = await settingsService.getSetting(key, null, companyId);
    if (value === null || typeof value === 'undefined') throw new NotFoundError('Setting not found');
    if (key === 'company_profile') {
      value = await enrichCompanyProfileValue(value);
    }
    successResponse(res, 'Setting fetched', { key, value });
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

    let value = req.body.value;
    if (key === 'company_profile' && value && typeof value === 'object') {
      const existing = await settingsService.getSetting('company_profile', {}, req.user.company_id);
      value = { ...(existing || {}), ...value };
    }
    if (key === 'asset_config' && value && typeof value === 'object') {
      const names = Array.isArray(value.categories) ? value.categories : [];
      const assetsService = require('../services/assets.service');
      for (const name of names) {
        await assetsService.ensureCategory(name, req.user.company_id);
      }
    }

    const { data, error } = await settingsService.setSetting(
      key,
      value,
      req.user.id,
      req.user.company_id
    );
    if (error) throw new BadRequestError(error.message);

    let responseValue = req.body.value;
    if (key === 'company_profile') {
      responseValue = await enrichCompanyProfileValue(value);
    }

    successResponse(res, 'Setting updated', data ? { ...data, key, value: responseValue } : { key, value: responseValue });
  } catch (err) {
    next(err);
  }
};

const getCompanyProfile = async (req, res, next) => {
  try {
    const companyId = req.user.company_id;
    const value = await settingsService.getSetting('company_profile', {}, companyId);
    const enriched = await enrichCompanyProfileValue(value || {});
    successResponse(res, 'Company profile fetched', enriched);
  } catch (err) {
    next(err);
  }
};

const uploadCompanyLogoHandler = async (req, res, next) => {
  try {
    if (!req.file) throw new BadRequestError('Logo file is required');
    const ext = String(req.file.originalname || '').split('.').pop().toLowerCase();
    if (!['png', 'jpg', 'jpeg'].includes(ext)) {
      throw new BadRequestError('Logo must be PNG or JPG');
    }
    if (req.file.size > 2 * 1024 * 1024) {
      throw new BadRequestError('Logo must be 2MB or smaller');
    }

    const companyId = req.user.company_id;
    const { path } = await uploadCompanyLogo(req.file, companyId);
    const existing = await settingsService.getSetting('company_profile', {}, companyId) || {};
    const profile = {
      ...existing,
      logoPath: path,
      logoName: req.file.originalname,
    };
    await settingsService.setSetting('company_profile', profile, req.user.id, companyId);
    const logoUrl = await getSignedUrl(STORAGE_BUCKETS.documents, path, 86400);
    const enriched = await enrichCompanyProfileValue(profile);
    successResponse(res, 'Company logo uploaded', {
      logoPath: path,
      logoUrl,
      logoName: req.file.originalname,
      companyProfile: enriched,
    });
  } catch (err) {
    next(err);
  }
};

// Payroll Components (Dynamic Salary Structure)
const getPayrollComponents = async (req, res, next) => {
  try {
    const companyId = req.user.company_id;
    const { data, error } = await supabaseAdmin
      .from('payroll_components')
      .select('*')
      .eq('company_id', companyId)
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
        company_id: req.user.company_id,
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
      .eq('company_id', req.user.company_id)
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
      .eq('company_id', req.user.company_id)
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
    const value = await settingsService.getSetting('leave_allocations', null, req.user.company_id);
    successResponse(res, 'Leave allocations fetched', value);
  } catch (err) { next(err); }
};

const updateLeaveAllocations = async (req, res, next) => {
  try {
    const allocations = req.body?.allocations;
    if (!allocations || typeof allocations !== 'object') {
      throw new BadRequestError('allocations object is required');
    }
    const { data, error } = await settingsService.setSetting(
      'leave_allocations', allocations, req.user.id, req.user.company_id
    );
    if (error) throw new BadRequestError(error.message);
    successResponse(res, 'Leave allocations updated', data);
  } catch (err) { next(err); }
};

// Leave Policy v2 (supports enable/disable + custom display name per type)
const getLeavePolicy = async (req, res, next) => {
  try {
    const value = await settingsService.getSetting('leave_policy', null, req.user.company_id);
    successResponse(res, 'Leave policy fetched', value);
  } catch (err) { next(err); }
};

const updateLeavePolicy = async (req, res, next) => {
  try {
    const policy = normalizeLeavePolicy(req.body?.policy);

    const { data, error } = await settingsService.setSetting(
      'leave_policy', policy, req.user.id, req.user.company_id
    );
    if (error) throw new BadRequestError(error.message);
    successResponse(res, 'Leave policy updated', data);
  } catch (err) { next(err); }
};

const applyLeavePolicyToAll = async (req, res, next) => {
  try {
    const year = parseInt(req.query.year, 10);
    if (!year) throw new BadRequestError('year query param is required');

    const rawPolicy = await settingsService.getSetting('leave_policy', null, req.user.company_id);
    const policy = normalizeLeavePolicy(rawPolicy);

    const tenantService = require('../services/tenant.service');
    const employeeIds = await tenantService.getCompanyEmployeeIds(req.user.company_id);

    for (const item of policy) {
      const code = item.code;
      const allocation = Number(item.allocation || 0);
      const active = item.active !== false;

      const { data: existing, error: exErr } = await supabaseAdmin
        .from('leave_balances')
        .select('employee_id')
        .eq('year', year)
        .eq('leave_type', code)
        .in('employee_id', employeeIds.length ? employeeIds : ['00000000-0000-0000-0000-000000000000']);
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

      if (employeeIds.length) {
        const { error: updErr } = await supabaseAdmin
          .from('leave_balances')
          .update({ total_allocated: active ? allocation : 0 })
          .eq('year', year)
          .eq('leave_type', code)
          .in('employee_id', employeeIds);
        if (updErr) throw new BadRequestError(updErr.message);
      }
    }

    successResponse(res, 'Leave policy applied to all employees', { year });
  } catch (err) { next(err); }
};

// Apply leave allocations to ALL employees (bulk update leave_balances for a year)
const applyLeaveAllocationsToAll = async (req, res, next) => {
  try {
    const year = parseInt(req.query.year, 10);
    if (!year) throw new BadRequestError('year query param is required');

    const allocations = await settingsService.getSetting('leave_allocations', null, req.user.company_id);
    if (!allocations || typeof allocations !== 'object') {
      throw new BadRequestError('Leave allocations are not configured yet');
    }

    const tenantService = require('../services/tenant.service');
    const employeeIds = await tenantService.getCompanyEmployeeIds(req.user.company_id);
    if (!employeeIds.length) {
      return successResponse(res, 'Leave allocations applied to all employees', { year, types: [], updated: 0 });
    }

    const types = Object.keys(allocations);
    for (const t of types) {
      await supabaseAdmin
        .from('leave_balances')
        .update({ total_allocated: Number(allocations[t] || 0) })
        .eq('year', year)
        .eq('leave_type', t)
        .in('employee_id', employeeIds);
    }

    successResponse(res, 'Leave allocations applied to all employees', { year, types });
  } catch (err) { next(err); }
};

module.exports = {
  getAll,
  getByKey,
  updateKey,
  uploadCompanyLogo: uploadCompanyLogoHandler,
  getCompanyProfile,
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

