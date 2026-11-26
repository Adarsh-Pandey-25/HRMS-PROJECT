const { getHrEmailRecipients } = require('./emailRecipients.service');
const { supabaseAdmin } = require('../config/supabase');
const { BadRequestError, NotFoundError } = require('../utils/errors');
const settingsService = require('./settings.service');
const { uploadResume, getSignedUrl, STORAGE_BUCKETS } = require('./storage.service');
const emailService = require('./email.service');
const logger = require('../utils/logger');

/** Offer accepted/rejected notices go to HR — see emailRecipients.service.js. */
const notifyHrAdmins = async (companyId, send) => {
  const recipients = await getHrEmailRecipients(companyId);
  for (const r of recipients) {
    send(r).catch((e) => logger.warn('Recruitment notification email failed', { error: e.message }));
  }
};

/**
 * Fixed, reasonable source list for the Add Candidate dropdown. "website":
 * applied on the company's own website (Careers API, careers.service.js).
 */
const CANDIDATE_SOURCES = ['referral', 'job-board', 'linkedin', 'direct', 'website', 'other'];

const INTERVIEW_MODES = ['video', 'in-person', 'phone'];
const INTERVIEW_STATUSES = ['scheduled', 'completed', 'cancelled', 'no-show'];
const OFFER_STATUSES = ['pending', 'accepted', 'declined', 'withdrawn'];

/** Audit finding N-08: updateOfferStatus previously let any status go to
 *  any other status — including declined/withdrawn back to accepted,
 *  which moved the candidate to "hired" for a legitimately rejected/pulled
 *  offer. declined and withdrawn are terminal; accepted may still be
 *  withdrawn (e.g. a background check fails after acceptance). */
const OFFER_STATUS_TRANSITIONS = {
  pending: ['accepted', 'declined', 'withdrawn'],
  accepted: ['withdrawn'],
  declined: [],
  withdrawn: [],
};

/** None of these list endpoints paginate — each tenant's own recruitment
 *  pipeline is naturally small and slow-growing, so a hard cap (rather than
 *  full page/limit controls) is enough to stop a single request from ever
 *  returning an unbounded response as one tenant's data grows over years. */
const RECRUITMENT_LIST_CAP = 500;

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
    .order('created_at', { ascending: false })
    .limit(RECRUITMENT_LIST_CAP);
  if (query.status) db = db.eq('status', query.status);
  const { data, error } = await db;
  if (error) throw new BadRequestError(error.message);
  return data || [];
};

const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'contract', 'intern'];
const WORK_MODES = ['on_site', 'remote', 'hybrid'];
const JOB_TITLE_MAX = 200;

/**
 * The columns 20261126_careers_api.sql adds to job_openings. Before it has
 * run, a job is still saved with the earlier columns (and these left out).
 */
const CAREERS_JOB_COLUMNS = [
  'updated_at', 'show_on_website', 'summary', 'work_mode', 'experience_min', 'experience_max',
  'salary_min', 'salary_max', 'salary_currency', 'salary_period', 'show_salary', 'skills', 'closes_on', 'questions',
];
const isCareersColumnMissing = (error) => {
  const message = String(error?.message || '');
  return /does not exist|schema cache/i.test(message) && CAREERS_JOB_COLUMNS.some((c) => message.includes(c));
};
const withoutCareersColumns = (payload) => Object.fromEntries(
  Object.entries(payload).filter(([key]) => !CAREERS_JOB_COLUMNS.includes(key)),
);

const pick = (body, ...keys) => {
  for (const key of keys) if (body[key] !== undefined) return body[key];
  return undefined;
};

const jobStatusOf = (value) => {
  const raw = String(value || 'open').toLowerCase();
  if (['active', 'open'].includes(raw)) return 'open';
  if (['closed', 'inactive', 'filled'].includes(raw)) return 'closed';
  return 'open';
};

/**
 * The job's other details, checked — only the ones present in `body`
 * (snake_case or camelCase). Shown on the company's website when
 * show_on_website is on (Careers API, careers.service.js).
 */
const jobDetailsFrom = (body = {}) => {
  const out = {};
  const blank = (v) => v === null || v === '';

  const employmentType = pick(body, 'employment_type', 'employmentType');
  if (employmentType !== undefined) {
    const type = String(employmentType || 'full_time').toLowerCase().replace(/-/g, '_');
    if (!EMPLOYMENT_TYPES.includes(type)) throw new BadRequestError('Type must be full-time, part-time, contract or intern');
    out.employment_type = type;
  }

  const summary = pick(body, 'summary');
  if (summary !== undefined) {
    const text = blank(summary) ? '' : String(summary).trim();
    if (text.length > 300) throw new BadRequestError('Keep the short summary under 300 characters');
    out.summary = text || null;
  }

  const workMode = pick(body, 'work_mode', 'workMode');
  if (workMode !== undefined) {
    if (blank(workMode)) out.work_mode = null;
    else if (!WORK_MODES.includes(workMode)) throw new BadRequestError('Work mode must be on site, remote or hybrid');
    else out.work_mode = workMode;
  }

  const range = (minKeys, maxKeys, { label, min, max, integer, minColumn, maxColumn }) => {
    const read = (value, which) => {
      if (value === undefined) return undefined;
      if (blank(value)) return null;
      const n = Number(value);
      if (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) {
        throw new BadRequestError(`${label} (${which}) must be ${integer ? 'a whole number' : 'a number'} from ${min} to ${max}`);
      }
      return n;
    };
    const lo = read(pick(body, ...minKeys), 'from');
    const hi = read(pick(body, ...maxKeys), 'to');
    if (lo !== undefined) out[minColumn] = lo;
    if (hi !== undefined) out[maxColumn] = hi;
    if (lo != null && hi != null && lo > hi) throw new BadRequestError(`${label}: "from" can't be more than "to"`);
  };
  range(['experience_min', 'experienceMin'], ['experience_max', 'experienceMax'], {
    label: 'Experience in years', min: 0, max: 60, integer: true, minColumn: 'experience_min', maxColumn: 'experience_max',
  });
  range(['salary_min', 'salaryMin'], ['salary_max', 'salaryMax'], {
    label: 'Salary', min: 0, max: 1e11, integer: false, minColumn: 'salary_min', maxColumn: 'salary_max',
  });

  const currency = pick(body, 'salary_currency', 'salaryCurrency');
  if (currency !== undefined) {
    const code = String(currency || 'INR').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) throw new BadRequestError('Currency must be a 3-letter code such as INR');
    out.salary_currency = code;
  }
  const period = pick(body, 'salary_period', 'salaryPeriod');
  if (period !== undefined) {
    if (!['year', 'month'].includes(period)) throw new BadRequestError('Salary is per year or per month');
    out.salary_period = period;
  }

  for (const [column, keys] of [['show_salary', ['show_salary', 'showSalary']], ['show_on_website', ['show_on_website', 'showOnWebsite']]]) {
    const value = pick(body, ...keys);
    if (value === undefined) continue;
    if (typeof value !== 'boolean') throw new BadRequestError(`${column} must be true or false`);
    out[column] = value;
  }

  const skills = pick(body, 'skills');
  if (skills !== undefined) {
    const list = Array.isArray(skills) ? skills : String(skills || '').split(',');
    const unique = [];
    for (const raw of list) {
      const skill = String(raw ?? '').trim();
      if (!skill) continue;
      if (skill.length > 40) throw new BadRequestError('Keep each skill under 40 characters');
      if (!unique.some((s) => s.toLowerCase() === skill.toLowerCase())) unique.push(skill);
    }
    if (unique.length > 20) throw new BadRequestError('Add at most 20 skills');
    out.skills = unique;
  }

  const closesOn = pick(body, 'closes_on', 'closesOn');
  if (closesOn !== undefined) {
    if (blank(closesOn)) out.closes_on = null;
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(String(closesOn)) || Number.isNaN(Date.parse(`${closesOn}T00:00:00Z`))) {
      throw new BadRequestError('The closing date must be a date');
    } else out.closes_on = String(closesOn);
  }

  const questions = pick(body, 'questions');
  if (questions !== undefined) {
    out.questions = require('./careers.service').normalizeQuestions(questions);
  }
  return out;
};

/** Saves a job; before 20261126_careers_api.sql has run, without the new details. */
const writeJob = async (run, payload) => {
  let { data, error } = await run(payload);
  if (error && isCareersColumnMissing(error)) {
    logger.warn('[Recruitment] job saved without its website details — run 20261126_careers_api.sql');
    ({ data, error } = await run(withoutCareersColumns(payload)));
  }
  return { data, error };
};

const createJob = async (body, companyId) => {
  const cid = resolveCompanyId(companyId);

  const payload = {
    title: String(body.title || '').trim(),
    department: body.department || null,
    location: body.location || null,
    employment_type: 'full_time',
    status: jobStatusOf(body.status),
    openings: Number(body.openings) > 0 ? Number(body.openings) : 1,
    company_id: cid,
    ...jobDetailsFrom(body),
  };

  if (!payload.title) throw new BadRequestError('Job title is required');
  if (payload.title.length > JOB_TITLE_MAX) throw new BadRequestError(`Keep the job title under ${JOB_TITLE_MAX} characters`);

  // Prefer storing description when the column exists (migration add_job_description.sql)
  const insert = (row) => supabaseAdmin.from('job_openings').insert(row).select().single();
  const withDesc = { ...payload, description: body.description || null };
  let { data, error } = await writeJob(insert, withDesc);

  if (error && /description/i.test(error.message || '')) {
    ({ data, error } = await writeJob(insert, payload));
  }

  if (error) throw new BadRequestError(error.message);
  return data;
};

/**
 * Edit a job of the requester's own company: any of its fields, including
 * closing it (status "closed") or putting it on / off the website.
 */
const updateJob = async (id, body = {}, companyId) => {
  const cid = resolveCompanyId(companyId);
  await assertOwnsJob(id, cid);

  const patch = { ...jobDetailsFrom(body), updated_at: new Date().toISOString() };
  if (body.title !== undefined) {
    const title = String(body.title || '').trim();
    if (!title) throw new BadRequestError('Job title is required');
    if (title.length > JOB_TITLE_MAX) throw new BadRequestError(`Keep the job title under ${JOB_TITLE_MAX} characters`);
    patch.title = title;
  }
  if (body.department !== undefined) patch.department = body.department || null;
  if (body.location !== undefined) patch.location = body.location ? String(body.location).trim().slice(0, 200) : null;
  if (body.description !== undefined) patch.description = body.description || null;
  if (body.status !== undefined) patch.status = jobStatusOf(body.status);
  if (body.openings !== undefined) {
    const openings = Number(body.openings);
    if (!Number.isInteger(openings) || openings < 1) throw new BadRequestError('Openings must be at least 1');
    patch.openings = openings;
  }

  const update = (row) => supabaseAdmin
    .from('job_openings')
    .update(row)
    .eq('id', id)
    .eq('company_id', cid)
    .select()
    .single();
  const { data, error } = await writeJob(update, patch);
  if (error) throw new BadRequestError(error.message);
  if (!data) throw new NotFoundError('Job opening not found');
  return data;
};

const listCandidates = async (query = {}, companyId) => {
  const cid = resolveCompanyId(companyId);
  let db = supabaseAdmin
    .from('candidates')
    .select('*')
    .eq('company_id', cid)
    .order('applied_on', { ascending: false })
    .limit(RECRUITMENT_LIST_CAP);
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
    .order('scheduled_at', { ascending: true })
    .limit(RECRUITMENT_LIST_CAP);
  if (error) throw new BadRequestError(error.message);
  return data || [];
};

const listOffers = async (companyId) => {
  const cid = resolveCompanyId(companyId);
  const { data, error } = await supabaseAdmin
    .from('job_offers')
    .select('*, candidate:candidate_id(id, name, email)')
    .eq('company_id', cid)
    .order('offered_on', { ascending: false })
    .limit(RECRUITMENT_LIST_CAP);
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

  if (candidate.email) {
    emailService.offerLetterEmail(candidate, {
      role: payload.designation || 'the role',
      ctc: payload.amount,
      currency: payload.currency,
      joiningDate: payload.joining_date,
    }).catch((e) => logger.warn('offerLetterEmail failed', { error: e.message }));
  }

  return data;
};

/**
 * Record a candidate's response to an offer. This is the only place
 * job_offers.status ever changes after creation — without it, an offer sat
 * at 'pending' forever and the Onboarding Checklist (which only shows
 * accepted offers) was unreachable in real usage.
 */
const updateOfferStatus = async (id, status, companyId) => {
  const cid = resolveCompanyId(companyId);
  const normalized = String(status || '').trim().toLowerCase();
  if (!OFFER_STATUSES.includes(normalized)) throw new BadRequestError(`Invalid status: ${status}`);

  const { data: existing, error: findErr } = await supabaseAdmin
    .from('job_offers')
    .select('id, status, candidate_id')
    .eq('id', id)
    .eq('company_id', cid)
    .maybeSingle();
  if (findErr) throw new BadRequestError(findErr.message);
  if (!existing) throw new NotFoundError('Offer not found');

  const currentStatus = existing.status;
  const allowedNext = OFFER_STATUS_TRANSITIONS[currentStatus] || [];
  if (currentStatus !== normalized && !allowedNext.includes(normalized)) {
    throw new BadRequestError(`Cannot change offer status from '${currentStatus}' to '${normalized}'`);
  }

  const { data, error } = await supabaseAdmin
    .from('job_offers')
    .update({ status: normalized })
    .eq('id', id)
    .eq('company_id', cid)
    .select()
    .single();
  if (error) throw new BadRequestError(error.message);
  if (!data) throw new NotFoundError('Offer not found');

  // Keep the candidate's pipeline stage in sync with the outcome of the offer.
  if (normalized === 'accepted') {
    await moveCandidate(data.candidate_id, 'hired', cid);
  } else if (normalized === 'declined') {
    await moveCandidate(data.candidate_id, 'rejected', cid);
  }

  if (normalized === 'accepted' || normalized === 'declined') {
    const { data: candidate } = await supabaseAdmin
      .from('candidates')
      .select('id, name, email')
      .eq('id', data.candidate_id)
      .maybeSingle();
    if (candidate) {
      if (normalized === 'accepted') {
        notifyHrAdmins(cid, (recipient) =>
          emailService.offerAcceptedEmail(recipient, candidate, { role: data.designation || 'the role', joiningDate: data.joining_date }));
      } else {
        notifyHrAdmins(cid, (recipient) =>
          emailService.offerRejectedEmail(recipient, candidate, { role: data.designation || 'the role' }));
      }
    }
  }

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
  updateJob,
  listCandidates,
  createCandidate,
  getCandidateResumeUrl,
  moveCandidate,
  listInterviews,
  createInterview,
  updateInterviewOutcome,
  listOffers,
  createOffer,
  updateOfferStatus,
  getCandidateChecklist,
  setCandidateChecklistItem,
  CANDIDATE_SOURCES,
  EMPLOYMENT_TYPES,
  WORK_MODES,
  INTERVIEW_MODES,
  INTERVIEW_STATUSES,
  OFFER_STATUSES,
};
