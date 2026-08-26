const { supabaseAdmin } = require('../config/supabase');
const { BadRequestError, NotFoundError } = require('../utils/errors');
const settingsService = require('./settings.service');
const { uploadResume, getSignedUrl, STORAGE_BUCKETS } = require('./storage.service');

/** Fixed, reasonable source list for the Add Candidate dropdown. */
const CANDIDATE_SOURCES = ['referral', 'job-board', 'linkedin', 'direct', 'other'];

const INTERVIEW_MODES = ['video', 'in-person', 'phone'];
const INTERVIEW_STATUSES = ['scheduled', 'completed', 'cancelled', 'no-show'];

/** Stage moveCandidate() already recognizes for "an offer was made" — keep offer creation aligned with it. */
const OFFER_STAGE = 'offer';

/**
 * Resolve a tenant id or fail loudly. Silently falling back to a shared
 * default tenant is a cross-tenant leak waiting to happen — every caller
 * MUST supply a real company_id resolved from the authenticated user.
 */
const resolveCompanyId = (companyId) => {
  if (!companyId) throw new BadRequestError('Unable to resolve company for this request');
  return companyId;
};

/** Stage ids the Kanban board (HRMS/src/data/talent.js KANBAN_STAGES) ships with by default. */
const DEFAULT_STAGES = ['applied', 'screening', 'interview', 'technical', 'hr-round', 'offer', 'hired', 'rejected'];

const toStageId = (label) => String(label || '').trim().toLowerCase().replace(/\s+/g, '-');

/** Known-good stages for a tenant: the built-in defaults plus any custom pipeline configured in Settings → Recruitment. */
const resolveValidStages = async (companyId) => {
  const cfg = await settingsService.getSetting('recruitment_config', null, companyId);
  const configured = Array.isArray(cfg?.stages) ? cfg.stages.map(toStageId).filter(Boolean) : [];
  return new Set([...DEFAULT_STAGES, ...configured]);
};

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

/** Confirm a job opening id belongs to the requester's own company before attaching a candidate to it. */
const assertOwnsJob = async (jobId, companyId) => {
  const { data, error } = await supabaseAdmin
    .from('job_openings')
    .select('id')
    .eq('id', jobId)
    .eq('company_id', companyId)
    .maybeSingle();
  if (error) throw new BadRequestError(error.message);
  if (!data) throw new NotFoundError('Job opening not found');
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const createCandidate = async (body, file, companyId) => {
  const cid = resolveCompanyId(companyId);
  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  if (!name) throw new BadRequestError('Candidate name is required');
  if (!email || !EMAIL_RE.test(email)) throw new BadRequestError('A valid email is required');

  const jobId = body.job_id || body.jobId || null;
  if (jobId) await assertOwnsJob(jobId, cid);

  const source = String(body.source || '').trim().toLowerCase();
  if (source && !CANDIDATE_SOURCES.includes(source)) {
    throw new BadRequestError(`Invalid source: ${source}`);
  }

  let resumeUrl = null;
  if (file) {
    const { path } = await uploadResume(file, cid);
    resumeUrl = path;
  }

  const payload = {
    job_id: jobId,
    name,
    email,
    phone: body.phone ? String(body.phone).trim() : null,
    source: source || null,
    resume_url: resumeUrl,
    stage: 'applied',
    days_in_stage: 0,
    applied_on: new Date().toISOString().slice(0, 10),
    company_id: cid,
  };

  const { data, error } = await supabaseAdmin.from('candidates').insert(payload).select().single();
  if (error) throw new BadRequestError(error.message);
  return data;
};

const moveCandidate = async (id, stage, companyId) => {
  const cid = resolveCompanyId(companyId);
  const raw = String(stage || '').trim();
  if (!raw) throw new BadRequestError('stage is required');

  const validStages = await resolveValidStages(cid);
  if (!validStages.has(toStageId(raw))) {
    throw new BadRequestError(`Invalid stage: ${raw}`);
  }

  const { data, error } = await supabaseAdmin
    .from('candidates')
    .update({ stage: raw, days_in_stage: 0 })
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
    .select('*, candidate:candidate_id(id, name, email)')
    .eq('company_id', cid)
    .order('offered_on', { ascending: false });
  if (error) throw new BadRequestError(error.message);
  // Flatten the joined candidate name — the UI reads offer.candidateName directly.
  return (data || []).map(({ candidate, ...offer }) => ({ ...offer, candidate_name: candidate?.name || null }));
};

/** Fetch a candidate, confirming it belongs to the requester's own company. */
const getOwnedCandidate = async (candidateId, companyId) => {
  const { data, error } = await supabaseAdmin
    .from('candidates')
    .select('id, job_id, name, email, resume_url, company_id')
    .eq('id', candidateId)
    .maybeSingle();
  if (error) throw new BadRequestError(error.message);
  if (!data || data.company_id !== companyId) throw new NotFoundError('Candidate not found');
  return data;
};

/** Signed, time-limited URL to a candidate's uploaded resume. */
const getCandidateResumeUrl = async (candidateId, companyId) => {
  const cid = resolveCompanyId(companyId);
  const candidate = await getOwnedCandidate(candidateId, cid);
  if (!candidate.resume_url) throw new NotFoundError('No resume on file for this candidate');
  return getSignedUrl(STORAGE_BUCKETS.documents, candidate.resume_url);
};

const createInterview = async (body, companyId) => {
  const cid = resolveCompanyId(companyId);
  const candidateId = body.candidate_id || body.candidateId;
  if (!candidateId) throw new BadRequestError('candidate_id is required');
  const candidate = await getOwnedCandidate(candidateId, cid);

  const scheduledAt = body.scheduled_at || body.scheduledAt;
  if (!scheduledAt) throw new BadRequestError('scheduled_at is required');

  const interviewer = String(body.interviewer || '').trim();
  if (!interviewer) throw new BadRequestError('interviewer is required');

  const mode = String(body.mode || 'video').trim().toLowerCase();
  if (!INTERVIEW_MODES.includes(mode)) throw new BadRequestError(`Invalid mode: ${mode}`);

  const round = Number(body.round) > 0 ? Math.trunc(Number(body.round)) : 1;

  let jobId = body.job_id || body.jobId || candidate.job_id || null;
  if (jobId && jobId !== candidate.job_id) await assertOwnsJob(jobId, cid);

  const payload = {
    candidate_id: candidateId,
    job_id: jobId,
    scheduled_at: scheduledAt,
    interviewer,
    mode,
    round,
    panel: body.panel ? String(body.panel).trim() : null,
    status: 'scheduled',
    company_id: cid,
  };

  const { data, error } = await supabaseAdmin.from('interviews').insert(payload).select().single();
  if (error) throw new BadRequestError(error.message);
  return data;
};

/** Record an interview's outcome (status) and interviewer feedback once it has happened. */
const updateInterviewOutcome = async (id, body, companyId) => {
  const cid = resolveCompanyId(companyId);
  const status = String(body.status || '').trim().toLowerCase();
  if (!status) throw new BadRequestError('status is required');
  if (!INTERVIEW_STATUSES.includes(status)) throw new BadRequestError(`Invalid status: ${status}`);

  const update = { status };
  if (body.feedback !== undefined) update.feedback = body.feedback ? String(body.feedback) : null;

  const { data, error } = await supabaseAdmin
    .from('interviews')
    .update(update)
    .eq('id', id)
    .eq('company_id', cid)
    .select()
    .single();
  if (error) throw new BadRequestError(error.message);
  if (!data) throw new NotFoundError('Interview not found');
  return data;
};

const createOffer = async (body, companyId) => {
  const cid = resolveCompanyId(companyId);
  const candidateId = body.candidate_id || body.candidateId;
  if (!candidateId) throw new BadRequestError('candidate_id is required');
  const candidate = await getOwnedCandidate(candidateId, cid);

  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestError('A valid offer amount is required');

  const payload = {
    candidate_id: candidateId,
    job_id: candidate.job_id || null,
    amount,
    currency: (body.currency ? String(body.currency).trim().toUpperCase() : 'INR') || 'INR',
    designation: body.designation ? String(body.designation).trim() : null,
    joining_date: body.joining_date || body.joiningDate || null,
    notes: body.notes ? String(body.notes) : null,
    status: 'pending',
    offered_on: new Date().toISOString().slice(0, 10),
    company_id: cid,
  };

  const { data, error } = await supabaseAdmin.from('job_offers').insert(payload).select().single();
  if (error) throw new BadRequestError(error.message);

  // Reflect that an offer was made in the candidate's pipeline stage.
  await moveCandidate(candidateId, OFFER_STAGE, cid);

  return data;
};

/**
 * Confirm this candidate id belongs to the requester's own company before
 * exposing or mutating its onboarding checklist — defense-in-depth against a
 * caller supplying a candidate id that happens to exist in another tenant.
 */
const assertOwnsCandidate = async (candidateId, companyId) => {
  const { data, error } = await supabaseAdmin
    .from('candidates')
    .select('id')
    .eq('id', candidateId)
    .eq('company_id', companyId)
    .maybeSingle();
  if (error) throw new BadRequestError(error.message);
  if (!data) throw new NotFoundError('Candidate not found');
};

/** This company's active checklist templates, joined with this candidate's checked state (unchecked if no row yet). */
const getCandidateChecklist = async (candidateId, companyId) => {
  const cid = resolveCompanyId(companyId);
  await assertOwnsCandidate(candidateId, cid);

  const { data: templates, error: templatesError } = await supabaseAdmin
    .from('onboarding_checklist_templates')
    .select('id, label, sort_order')
    .eq('company_id', cid)
    .eq('is_active', true)
    .order('sort_order', { ascending: true });
  if (templatesError) throw new BadRequestError(templatesError.message);

  const { data: statuses, error: statusError } = await supabaseAdmin
    .from('onboarding_checklist_status')
    .select('template_id, is_checked, checked_by, checked_at')
    .eq('candidate_id', candidateId);
  if (statusError) throw new BadRequestError(statusError.message);

  const statusByTemplate = new Map((statuses || []).map((s) => [s.template_id, s]));
  return (templates || []).map((t) => {
    const status = statusByTemplate.get(t.id);
    return {
      template_id: t.id,
      label: t.label,
      sort_order: t.sort_order,
      is_checked: status?.is_checked || false,
      checked_by: status?.checked_by || null,
      checked_at: status?.checked_at || null,
    };
  });
};

/** Toggle one checklist item for one candidate, recording who/when it was checked. */
const setCandidateChecklistItem = async (candidateId, templateId, isChecked, companyId, checkedByEmployeeId) => {
  const cid = resolveCompanyId(companyId);
  await assertOwnsCandidate(candidateId, cid);

  // Defense-in-depth: the template id must also belong to this company, not
  // just any UUID that happens to exist for another tenant.
  const { data: template, error: templateError } = await supabaseAdmin
    .from('onboarding_checklist_templates')
    .select('id')
    .eq('id', templateId)
    .eq('company_id', cid)
    .maybeSingle();
  if (templateError) throw new BadRequestError(templateError.message);
  if (!template) throw new NotFoundError('Checklist item not found');

  const { data, error } = await supabaseAdmin
    .from('onboarding_checklist_status')
    .upsert(
      {
        candidate_id: candidateId,
        template_id: templateId,
        is_checked: isChecked,
        checked_by: isChecked ? checkedByEmployeeId : null,
        checked_at: isChecked ? new Date().toISOString() : null,
      },
      { onConflict: 'candidate_id,template_id' }
    )
    .select('template_id, is_checked, checked_by, checked_at')
    .single();
  if (error) throw new BadRequestError(error.message);
  return data;
};

module.exports = {
  listJobs,
  createJob,
  listCandidates,
  createCandidate,
  getCandidateResumeUrl,
  moveCandidate,
  listInterviews,
  createInterview,
  updateInterviewOutcome,
  listOffers,
  createOffer,
  getCandidateChecklist,
  setCandidateChecklistItem,
  CANDIDATE_SOURCES,
  INTERVIEW_MODES,
  INTERVIEW_STATUSES,
};
