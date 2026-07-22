const { supabaseAdmin } = require('../config/supabase');
const { BadRequestError, NotFoundError } = require('../utils/errors');
const { DEFAULT_COMPANY_ID } = require('../utils/tenant');
const moment = require('moment-timezone');
const { TIMEZONE } = require('../utils/constants');

const emptyId = '00000000-0000-0000-0000-000000000000';
const REQUEST_STATUSES = new Set(['requested', 'pending', 'approved', 'rejected', 'fulfilled', 'cancelled']);
const ASSET_STATUSES = new Set(['available', 'assigned', 'in-repair', 'retired']);

const resolveCompanyId = (companyId) => companyId || DEFAULT_COMPANY_ID;

const todayIST = () => moment.tz(TIMEZONE).format('YYYY-MM-DD');

const assertInCompany = async (table, id, companyId, employeeField = null, companyEmployeeIds = null) => {
  const cid = resolveCompanyId(companyId);
  let q = supabaseAdmin.from(table).select('id, company_id').eq('id', id).eq('company_id', cid);
  if (employeeField && companyEmployeeIds) {
    q = supabaseAdmin.from(table).select(`id, company_id, ${employeeField}`).eq('id', id).eq('company_id', cid);
  }
  const { data } = await q.maybeSingle();
  if (!data) throw new NotFoundError('Record not found');
  if (employeeField && companyEmployeeIds && !companyEmployeeIds.includes(data[employeeField])) {
    throw new NotFoundError('Record not found');
  }
  return data;
};

const ensureCategory = async (name, companyId) => {
  const trimmed = String(name || '').trim();
  if (!trimmed) return null;
  const cid = resolveCompanyId(companyId);
  const { data: existing } = await supabaseAdmin
    .from('asset_categories')
    .select('id')
    .eq('company_id', cid)
    .ilike('name', trimmed)
    .maybeSingle();
  if (existing) return existing;
  const { data, error } = await supabaseAdmin
    .from('asset_categories')
    .insert({ name: trimmed, company_id: cid })
    .select()
    .single();
  if (error) throw new BadRequestError(error.message);
  return data;
};

const listAssets = async (query = {}, _companyEmployeeIds = null, companyId = null) => {
  const cid = resolveCompanyId(companyId);
  let db = supabaseAdmin
    .from('assets')
    .select('*')
    .eq('company_id', cid)
    .order('created_at', { ascending: false });
  if (query.status) db = db.eq('status', query.status);
  if (query.assigned_to) db = db.eq('assigned_to', query.assigned_to);
  const { data, error } = await db;
  if (error) throw new BadRequestError(error.message);
  return data || [];
};

const myAssets = async (employeeId, companyId = null) => {
  let db = supabaseAdmin
    .from('assets')
    .select('*')
    .eq('assigned_to', employeeId)
    .order('assigned_on', { ascending: false });
  if (companyId) db = db.eq('company_id', resolveCompanyId(companyId));
  const { data, error } = await db;
  if (error) throw new BadRequestError(error.message);
  return data || [];
};

const listRequests = async (query = {}, companyEmployeeIds = null, companyId = null) => {
  let db = supabaseAdmin
    .from('asset_requests')
    .select('*, employee:employee_id(id, first_name, last_name)')
    .order('created_at', { ascending: false });
  if (companyId) db = db.eq('company_id', resolveCompanyId(companyId));
  if (query.status) db = db.eq('status', query.status);
  if (query.employee_id) db = db.eq('employee_id', query.employee_id);
  if (companyEmployeeIds) {
    db = db.in('employee_id', companyEmployeeIds.length ? companyEmployeeIds : [emptyId]);
  }
  const { data, error } = await db;
  if (error) throw new BadRequestError(error.message);
  return data || [];
};

const createRequest = async (employeeId, body, companyId = null) => {
  const assetType = String(body.asset_type || body.assetType || '').trim();
  const reason = String(body.reason || '').trim();
  if (!assetType) throw new BadRequestError('Asset type is required');
  if (!reason) throw new BadRequestError('Reason is required');

  const payload = {
    employee_id: employeeId,
    asset_type: assetType,
    reason,
    urgency: ['low', 'medium', 'high'].includes(body.urgency) ? body.urgency : 'medium',
    status: 'requested',
    requested_on: todayIST(),
  };
  if (companyId) payload.company_id = resolveCompanyId(companyId);

  const { data, error } = await supabaseAdmin
    .from('asset_requests')
    .insert(payload)
    .select()
    .single();
  if (error) throw new BadRequestError(error.message);
  return data;
};

const updateRequestStatus = async (id, status, companyEmployeeIds = null, companyId = null) => {
  const normalized = String(status || '').toLowerCase();
  if (!REQUEST_STATUSES.has(normalized)) {
    throw new BadRequestError('Invalid request status');
  }

  if (companyId || companyEmployeeIds) {
    const cid = resolveCompanyId(companyId);
    const { data: existing } = await supabaseAdmin
      .from('asset_requests')
      .select('employee_id, company_id')
      .eq('id', id)
      .eq('company_id', cid)
      .maybeSingle();
    if (!existing) throw new NotFoundError('Request not found');
    if (companyEmployeeIds && !companyEmployeeIds.includes(existing.employee_id)) {
      throw new NotFoundError('Request not found');
    }
  }

  let upd = supabaseAdmin.from('asset_requests').update({ status: normalized }).eq('id', id);
  if (companyId) upd = upd.eq('company_id', resolveCompanyId(companyId));
  const { data, error } = await upd.select().single();
  if (error) throw new BadRequestError(error.message);
  if (!data) throw new NotFoundError('Request not found');
  return data;
};

const emptyToNull = (value) => (value === '' || value === undefined ? null : value);

const pickAssetFields = (body) => ({
  name: String(body.name || '').trim(),
  category: emptyToNull(body.category),
  brand: emptyToNull(body.brand),
  model: emptyToNull(body.model),
  serial_number: emptyToNull(body.serial_number || body.serialNumber),
  purchase_date: emptyToNull(body.purchase_date || body.purchaseDate),
  purchase_cost: body.purchase_cost != null || body.purchaseCost != null
    ? Number(body.purchase_cost ?? body.purchaseCost ?? 0)
    : null,
  warranty_expiry: emptyToNull(body.warranty_expiry || body.warrantyExpiry),
  location: emptyToNull(body.location),
});

const createAsset = async (body, companyId) => {
  const cid = resolveCompanyId(companyId);
  const fields = pickAssetFields(body);
  if (!fields.name) throw new BadRequestError('Asset name is required');

  if (fields.category) await ensureCategory(fields.category, cid);

  const row = {
    ...fields,
    status: 'available',
    assigned_to: null,
    assigned_on: null,
    company_id: cid,
  };

  const { data, error } = await supabaseAdmin
    .from('assets')
    .insert(row)
    .select()
    .single();
  if (error) throw new BadRequestError(error.message);
  return data;
};

const updateAsset = async (id, body, companyId, companyEmployeeIds = null) => {
  await assertInCompany('assets', id, companyId);

  const fields = pickAssetFields(body);
  if (body.name !== undefined && !fields.name) throw new BadRequestError('Asset name is required');

  const patch = {};
  if (body.name !== undefined) patch.name = fields.name;
  if (body.category !== undefined || body.category === '') {
    patch.category = fields.category;
    if (fields.category) await ensureCategory(fields.category, companyId);
  }
  if (body.brand !== undefined) patch.brand = fields.brand;
  if (body.model !== undefined) patch.model = fields.model;
  if (body.serial_number !== undefined || body.serialNumber !== undefined) patch.serial_number = fields.serial_number;
  if (body.purchase_date !== undefined || body.purchaseDate !== undefined) patch.purchase_date = fields.purchase_date;
  if (body.purchase_cost !== undefined || body.purchaseCost !== undefined) patch.purchase_cost = fields.purchase_cost;
  if (body.warranty_expiry !== undefined || body.warrantyExpiry !== undefined) patch.warranty_expiry = fields.warranty_expiry;
  if (body.location !== undefined) patch.location = fields.location;
  if (body.status !== undefined) {
    const st = String(body.status).toLowerCase();
    if (!ASSET_STATUSES.has(st)) throw new BadRequestError('Invalid asset status');
    patch.status = st;
  }

  patch.updated_at = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from('assets')
    .update(patch)
    .eq('id', id)
    .eq('company_id', resolveCompanyId(companyId))
    .select()
    .single();
  if (error) throw new BadRequestError(error.message);
  if (!data) throw new NotFoundError('Asset not found');
  return data;
};

const assignAsset = async (id, employeeId, companyId, companyEmployeeIds = null) => {
  await assertInCompany('assets', id, companyId);
  if (!employeeId) throw new BadRequestError('Employee is required');
  if (companyEmployeeIds && !companyEmployeeIds.includes(employeeId)) {
    throw new BadRequestError('Employee not found in your company');
  }

  const { data: employee } = await supabaseAdmin
    .from('employees')
    .select('id')
    .eq('id', employeeId)
    .eq('company_id', resolveCompanyId(companyId))
    .maybeSingle();
  if (!employee) throw new NotFoundError('Employee not found');

  const { data, error } = await supabaseAdmin
    .from('assets')
    .update({
      assigned_to: employeeId,
      assigned_on: todayIST(),
      status: 'assigned',
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('company_id', resolveCompanyId(companyId))
    .select()
    .single();
  if (error) throw new BadRequestError(error.message);
  if (!data) throw new NotFoundError('Asset not found');
  return data;
};

const returnAsset = async (id, companyId) => {
  await assertInCompany('assets', id, companyId);

  const { data, error } = await supabaseAdmin
    .from('assets')
    .update({
      assigned_to: null,
      assigned_on: null,
      status: 'available',
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('company_id', resolveCompanyId(companyId))
    .select()
    .single();
  if (error) throw new BadRequestError(error.message);
  if (!data) throw new NotFoundError('Asset not found');
  return data;
};

const listCategories = async (companyId) => {
  const cid = resolveCompanyId(companyId);
  const { data, error } = await supabaseAdmin
    .from('asset_categories')
    .select('*')
    .eq('company_id', cid)
    .order('name');
  if (error) throw new BadRequestError(error.message);
  return data || [];
};

const createCategory = async (body, companyId) => {
  const name = String(body.name || '').trim();
  if (!name) throw new BadRequestError('Category name is required');
  return ensureCategory(name, companyId);
};

const countPendingRequests = async (companyEmployeeIds = [], companyId = null) => {
  if (!companyEmployeeIds.length) return 0;
  let q = supabaseAdmin
    .from('asset_requests')
    .select('id', { count: 'exact', head: true })
    .in('status', ['requested', 'pending'])
    .in('employee_id', companyEmployeeIds);
  if (companyId) q = q.eq('company_id', resolveCompanyId(companyId));
  const { count, error } = await q;
  if (error) return 0;
  return count || 0;
};

module.exports = {
  listAssets,
  myAssets,
  listRequests,
  createRequest,
  updateRequestStatus,
  createAsset,
  updateAsset,
  assignAsset,
  returnAsset,
  listCategories,
  createCategory,
  countPendingRequests,
};
