const moment = require('moment-timezone');
const { supabaseAdmin } = require('../config/supabase');
const { BadRequestError, NotFoundError } = require('../utils/errors');
const { isMissingColumnError } = require('../utils/helpers');

const getCompanyProfile = async (companyId) => {
  const { data: company, error } = await supabaseAdmin
    .from('companies')
    .select('*')
    .eq('id', companyId)
    .maybeSingle();
  if (error) throw new BadRequestError(error.message);
  if (!company) throw new NotFoundError('Company not found');

  const { data: adminContact } = await supabaseAdmin
    .from('employees')
    .select('id, first_name, last_name, email, phone')
    .eq('company_id', companyId)
    .eq('role', 'admin')
    .eq('is_active', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  const { count: employeeCount } = await supabaseAdmin
    .from('employees')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .eq('is_active', true);

  return { ...company, adminContact: adminContact || null, employeeCount: employeeCount || 0 };
};

const updateCompanyProfile = async (companyId, { industry, companySize }) => {
  const patch = { updated_at: new Date().toISOString() };
  if (industry !== undefined) patch.industry = industry;
  if (companySize !== undefined) patch.company_size = companySize;
  const { data, error } = await supabaseAdmin
    .from('companies')
    .update(patch)
    .eq('id', companyId)
    .select('*')
    .maybeSingle();
  if (error) throw new BadRequestError(error.message);
  if (!data) throw new NotFoundError('Company not found');
  return data;
};

const listCompanyEmployees = async (companyId, { page = 1, limit = 20, search } = {}) => {
  const offset = (page - 1) * limit;
  let query = supabaseAdmin
    .from('employees')
    .select('id, employee_code, first_name, last_name, email, role, department, designation, is_active, date_of_joining', { count: 'exact' })
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (search) {
    query = query.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%,email.ilike.%${search}%`);
  }
  const { data, error, count } = await query;
  if (error) throw new BadRequestError(error.message);
  return { data: data || [], total: count || 0 };
};

const getCompanySubscription = async (companyId) => {
  const { data: subscription } = await supabaseAdmin
    .from('company_billing_subscriptions')
    .select('*, plans:subscription_plans(*)')
    .eq('company_id', companyId)
    .in('status', ['trialing', 'active', 'past_due', 'grace_period', 'suspended'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: invoices } = await supabaseAdmin
    .from('subscription_invoices')
    .select('*')
    .eq('company_id', companyId)
    .order('issued_at', { ascending: false });

  let events = [];
  if (subscription) {
    const { data: eventRows } = await supabaseAdmin
      .from('subscription_events')
      .select('*')
      .eq('company_subscription_id', subscription.id)
      .order('created_at', { ascending: false });
    events = eventRows || [];
  }

  return { subscription: subscription || null, invoices: invoices || [], events };
};

/**
 * Feature adoption + a real login-activity proxy, per Module 2's spec. Logins
 * use refresh_tokens.created_at (issued exactly once per successful login) —
 * the only login-event record this codebase actually keeps; employees has no
 * last_login_at column. Storage uses document count as the size column
 * (document_url is a path/URL, not a byte size) isn't tracked anywhere —
 * documented here rather than faked.
 */
const getCompanyUsage = async (companyId) => {
  const since30d = moment().subtract(30, 'days').toISOString();

  const { data: employeeIdsRaw } = await supabaseAdmin
    .from('employees')
    .select('id')
    .eq('company_id', companyId);
  const employeeIds = (employeeIdsRaw || []).map((e) => e.id);
  if (employeeIds.length === 0) {
    return {
      activeLogins30d: 0,
      featureAdoption: { payroll: false, adms: false, training: false, assets: false },
      documentCount: 0,
      storageNote: 'No byte-size tracking exists for uploaded documents — document count is used as a proxy, not actual storage bytes.',
    };
  }

  const [
    { data: logins },
    { count: payrollRuns },
    { count: admsDevices },
    { count: trainingEnrollments },
    { count: assetsAssigned },
    { count: documentCount },
  ] = await Promise.all([
    supabaseAdmin.from('refresh_tokens').select('employee_id').in('employee_id', employeeIds).gte('created_at', since30d),
    supabaseAdmin.from('payroll').select('id', { count: 'exact', head: true }).eq('company_id', companyId),
    supabaseAdmin.from('device_employee_mapping').select('id', { count: 'exact', head: true }).in('employee_id', employeeIds),
    supabaseAdmin.from('course_enrollments').select('id', { count: 'exact', head: true }).in('employee_id', employeeIds),
    supabaseAdmin.from('assets').select('id', { count: 'exact', head: true }).in('assigned_to', employeeIds),
    supabaseAdmin.from('documents').select('id', { count: 'exact', head: true }).in('employee_id', employeeIds),
  ]);

  return {
    activeLogins30d: new Set((logins || []).map((r) => r.employee_id)).size,
    featureAdoption: {
      payroll: (payrollRuns || 0) > 0,
      adms: (admsDevices || 0) > 0,
      training: (trainingEnrollments || 0) > 0,
      assets: (assetsAssigned || 0) > 0,
    },
    documentCount: documentCount || 0,
    storageNote: 'No byte-size tracking exists for uploaded documents — document count is used as a proxy, not actual storage bytes.',
  };
};

// ── Internal notes ──────────────────────────────────────────────────────────

const listNotes = async (companyId) => {
  const { data, error } = await supabaseAdmin
    .from('company_internal_notes')
    .select('*, author:author_id(id, email, name)')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });
  if (error) {
    if (isMissingColumnError(error.message, 'company_internal_notes')) return [];
    throw new BadRequestError(error.message);
  }
  return data || [];
};

const addNote = async (companyId, authorId, note) => {
  const cleanNote = String(note || '').trim();
  if (!cleanNote) throw new BadRequestError('Note text is required');
  const { data, error } = await supabaseAdmin
    .from('company_internal_notes')
    .insert({ company_id: companyId, author_id: authorId, note: cleanNote })
    .select('*')
    .single();
  if (error) throw new BadRequestError(error.message);
  return data;
};

const deleteNote = async (companyId, noteId) => {
  const { error } = await supabaseAdmin
    .from('company_internal_notes')
    .delete()
    .eq('id', noteId)
    .eq('company_id', companyId);
  if (error) throw new BadRequestError(error.message);
  return { deleted: true };
};

module.exports = {
  getCompanyProfile,
  updateCompanyProfile,
  listCompanyEmployees,
  getCompanySubscription,
  getCompanyUsage,
  listNotes,
  addNote,
  deleteNote,
};
