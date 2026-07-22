const { supabaseAdmin } = require('../config/supabase');
const { BadRequestError, NotFoundError } = require('../utils/errors');
const { DEFAULT_COMPANY_ID } = require('../utils/tenant');

const resolveCompanyId = (companyId) => companyId || DEFAULT_COMPANY_ID;

const listJobs = async (query = {}, companyId) => {
  const cid = resolveCompanyId(companyId);
  let db = supabaseAdmin
    .from('job_openings')
    .select('*')
    .eq('company_id', cid)
    .order('created_at', { ascending: false });
  if (query.status) db = db.eq('status', query.status);
  const { data, error } = await db;
  if (error) throw new BadRequestError(error.message);
  return data || [];
};

const createJob = async (body, companyId) => {
  const cid = resolveCompanyId(companyId);
  const statusRaw = String(body.status || 'open').toLowerCase();
  const status = ['active', 'open'].includes(statusRaw) ? 'open'
    : ['closed', 'inactive', 'filled'].includes(statusRaw) ? 'closed'
    : 'open';

  const payload = {
    title: String(body.title || '').trim(),
    department: body.department || null,
    location: body.location || null,
    employment_type: body.employment_type || body.employmentType || 'full_time',
    status,
    openings: Number(body.openings) > 0 ? Number(body.openings) : 1,
    company_id: cid,
  };

  if (!payload.title) throw new BadRequestError('Job title is required');

  // Prefer storing description when the column exists (migration add_job_description.sql)
  const withDesc = { ...payload, description: body.description || null };
  let { data, error } = await supabaseAdmin.from('job_openings').insert(withDesc).select().single();

  if (error && /description/i.test(error.message || '')) {
    ({ data, error } = await supabaseAdmin.from('job_openings').insert(payload).select().single());
  }

  if (error) throw new BadRequestError(error.message);
  return data;
};

const listCandidates = async (query = {}, companyId) => {
  const cid = resolveCompanyId(companyId);
  let db = supabaseAdmin
    .from('candidates')
    .select('*')
    .eq('company_id', cid)
    .order('applied_on', { ascending: false });
  if (query.job_id) db = db.eq('job_id', query.job_id);
  if (query.stage) db = db.eq('stage', query.stage);
  const { data, error } = await db;
  if (error) throw new BadRequestError(error.message);
  return data || [];
};

const moveCandidate = async (id, stage, companyId) => {
  const cid = resolveCompanyId(companyId);
  const { data, error } = await supabaseAdmin
    .from('candidates')
    .update({ stage, days_in_stage: 0 })
    .eq('id', id)
    .eq('company_id', cid)
    .select()
    .single();
  if (error) throw new BadRequestError(error.message);
  if (!data) throw new NotFoundError('Candidate not found');
  return data;
};

const listInterviews = async (companyId) => {
  const cid = resolveCompanyId(companyId);
  const { data, error } = await supabaseAdmin
    .from('interviews')
    .select('*')
    .eq('company_id', cid)
    .order('scheduled_at', { ascending: true });
  if (error) throw new BadRequestError(error.message);
  return data || [];
};

const listOffers = async (companyId) => {
  const cid = resolveCompanyId(companyId);
  const { data, error } = await supabaseAdmin
    .from('job_offers')
    .select('*')
    .eq('company_id', cid)
    .order('offered_on', { ascending: false });
  if (error) throw new BadRequestError(error.message);
  return data || [];
};

module.exports = {
  listJobs,
  createJob,
  listCandidates,
  moveCandidate,
  listInterviews,
  listOffers,
};
