const { supabaseAdmin } = require('../config/supabase');
const { BadRequestError, NotFoundError } = require('../utils/errors');

const listAssets = async (query = {}) => {
  let db = supabaseAdmin.from('assets').select('*').order('created_at', { ascending: false });
  if (query.status) db = db.eq('status', query.status);
  if (query.assigned_to) db = db.eq('assigned_to', query.assigned_to);
  const { data, error } = await db;
  if (error) throw new BadRequestError(error.message);
  return data || [];
};

const myAssets = async (employeeId) => {
  const { data, error } = await supabaseAdmin
    .from('assets')
    .select('*')
    .eq('assigned_to', employeeId)
    .order('assigned_on', { ascending: false });
  if (error) throw new BadRequestError(error.message);
  return data || [];
};

const listRequests = async (query = {}) => {
  let db = supabaseAdmin.from('asset_requests').select('*, employee:employee_id(id, first_name, last_name)').order('created_at', { ascending: false });
  if (query.status) db = db.eq('status', query.status);
  if (query.employee_id) db = db.eq('employee_id', query.employee_id);
  const { data, error } = await db;
  if (error) throw new BadRequestError(error.message);
  return data || [];
};

const createRequest = async (employeeId, body) => {
  const { data, error } = await supabaseAdmin
    .from('asset_requests')
    .insert({
      employee_id: employeeId,
      asset_type: body.asset_type || body.assetType || 'Other',
      reason: body.reason || '',
      urgency: body.urgency || 'medium',
      status: 'requested',
      requested_on: new Date().toISOString().slice(0, 10),
    })
    .select()
    .single();
  if (error) throw new BadRequestError(error.message);
  return data;
};

const updateRequestStatus = async (id, status) => {
  const { data, error } = await supabaseAdmin
    .from('asset_requests')
    .update({ status })
    .eq('id', id)
    .select()
    .single();
  if (error) throw new BadRequestError(error.message);
  if (!data) throw new NotFoundError('Request not found');
  return data;
};

const createAsset = async (body) => {
  const { data, error } = await supabaseAdmin
    .from('assets')
    .insert({ status: 'available', assigned_to: null, assigned_on: null, ...body })
    .select()
    .single();
  if (error) throw new BadRequestError(error.message);
  return data;
};

const listCategories = async () => {
  const { data, error } = await supabaseAdmin.from('asset_categories').select('*').order('name');
  if (error) throw new BadRequestError(error.message);
  return data || [];
};

module.exports = {
  listAssets,
  myAssets,
  listRequests,
  createRequest,
  updateRequestStatus,
  createAsset,
  listCategories,
};
