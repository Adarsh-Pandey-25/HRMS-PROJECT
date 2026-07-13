const { supabaseAdmin } = require('../config/supabase');
const { BadRequestError, NotFoundError } = require('../utils/errors');

const listJobs = async (query = {}) => {
  let db = supabaseAdmin.from('job_openings').select('*').order('created_at', { ascending: false });
  if (query.status) db = db.eq('status', query.status);
  const { data, error } = await db;
  if (error) throw new BadRequestError(error.message);
  return data || [];
};

const createJob = async (body) => {
  const { data, error } = await supabaseAdmin
    .from('job_openings')
    .insert({ status: 'open', openings: body.openings || 1, ...body })
    .select()
    .single();
  if (error) throw new BadRequestError(error.message);
  return data;
};

const listCandidates = async (query = {}) => {
  let db = supabaseAdmin.from('candidates').select('*').order('applied_on', { ascending: false });
  if (query.job_id) db = db.eq('job_id', query.job_id);
  if (query.stage) db = db.eq('stage', query.stage);
  const { data, error } = await db;
  if (error) throw new BadRequestError(error.message);
  return data || [];
};

const moveCandidate = async (id, stage) => {
  const { data, error } = await supabaseAdmin
    .from('candidates')
    .update({ stage, days_in_stage: 0 })
    .eq('id', id)
    .select()
    .single();
  if (error) throw new BadRequestError(error.message);
  if (!data) throw new NotFoundError('Candidate not found');
  return data;
};

const listInterviews = async () => {
  const { data, error } = await supabaseAdmin.from('interviews').select('*').order('scheduled_at', { ascending: true });
  if (error) throw new BadRequestError(error.message);
  return data || [];
};

const listOffers = async () => {
  const { data, error } = await supabaseAdmin.from('job_offers').select('*').order('offered_on', { ascending: false });
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
