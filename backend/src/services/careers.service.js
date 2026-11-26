const crypto = require('crypto');
const moment = require('moment-timezone');
const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');
const {
  AppError, BadRequestError, NotFoundError, TooManyRequestsError,
} = require('../utils/errors');
const { isMissingColumnError } = require('../utils/helpers');
const { TIMEZONE } = require('../utils/constants');
const { phoneProblem, normalizePhone } = require('../utils/phone');
const { sanitizeJobHtml } = require('../utils/safeHtml');
const { runInBackground } = require('../utils/background');

/**
 * Careers API (owner's request, 26 Nov 2026): a company's own website shows
 * the jobs HR posts in SpaxSync, and a candidate's application on that
 * website comes straight into Recruitment, resume and all. Spaxads'
 * spaxads.com is the first; any website can use it (CAREERS_API.md).
 *
 * Each company has one careers set-up (careers_sites): on / off, a public
 * careers key, the websites allowed to use it, which form fields are asked
 * and the consent text. The key is public by design: it sits in the
 * website's page and only says whose jobs to show. What protects the
 * applications is:
 *  - only the company's listed websites may send them (Origin, checked here
 *    and by the browser through CORS, routes/careersPublic.routes.js);
 *  - the robot check (Cloudflare Turnstile) when the server has its keys;
 *  - limits per visitor (the routes) and per company per day (here);
 *  - a hidden spam-trap field; the resume's real file type; strict checks
 *    on every field.
 * The public side shows only open jobs that HR put on the website, and only
 * their public details; never candidates, internal notes or hidden salaries.
 *
 * Until 20261126_careers_api.sql has run, the public side answers that it
 * isn't set up and the Settings card says to run it.
 */

const SQL_FILE = '20261126_careers_api.sql';
const KEY_PATTERN = /^ck_[A-Za-z0-9_-]{20,60}$/;
const MAX_ORIGINS = 10;
const MAX_JOBS = 200;
const SITE_CACHE_MS = 30 * 1000;
const RESUME_TYPES = ['pdf', 'doc', 'docx'];
const RESUME_MAX_MB = 5;
const DEFAULT_DAILY_LIMIT = 200;

/** The form's other fields and how each is asked by default. Name and email are always required. */
const FIELDS = {
  phone: { label: 'Phone', default: 'required' },
  resume: { label: 'Resume', default: 'required' },
  currentLocation: { label: 'Current city', default: 'optional' },
  experienceYears: { label: 'Total experience (years)', default: 'optional' },
  currentCompany: { label: 'Current company', default: 'optional' },
  currentCtc: { label: 'Current salary (CTC per year)', default: 'optional' },
  expectedCtc: { label: 'Expected salary (CTC per year)', default: 'optional' },
  noticePeriodDays: { label: 'Notice period (days)', default: 'optional' },
  linkedinUrl: { label: 'LinkedIn profile', default: 'optional' },
  portfolioUrl: { label: 'Portfolio or website', default: 'hidden' },
  coverNote: { label: 'Why are you a good fit?', default: 'optional' },
};
const MODES = ['required', 'optional', 'hidden'];

const QUESTION_TYPES = ['text', 'textarea', 'number', 'yes_no', 'select'];
const MAX_QUESTIONS = 10;

const EMPLOYMENT_LABELS = { full_time: 'Full-time', part_time: 'Part-time', contract: 'Contract', intern: 'Internship' };
const WORK_MODE_LABELS = { on_site: 'On site', remote: 'Remote', hybrid: 'Hybrid' };

const PUBLIC_JOB_COLUMNS = [
  'id', 'company_id', 'title', 'department', 'location', 'employment_type', 'work_mode', 'summary',
  'description', 'experience_min', 'experience_max', 'salary_min', 'salary_max', 'salary_currency',
  'salary_period', 'show_salary', 'skills', 'openings', 'created_at', 'closes_on', 'questions',
  'status', 'show_on_website',
].join(', ');
const SITE_COLUMNS = 'company_id, enabled, site_key, allowed_origins, form_fields, consent_text, daily_limit, updated_at';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

const notSetUp = () => new AppError(`The careers website set-up isn't ready yet: run ${SQL_FILE} in Supabase.`, 503, 'NOT_SET_UP');
const isMissingTable = (error) => isMissingColumnError(error?.message, 'careers_sites');
const todayIst = () => moment().tz(TIMEZONE).format('YYYY-MM-DD');
const newSiteKey = () => `ck_${crypto.randomBytes(24).toString('base64url')}`;

const defaultConsentText = (companyName) => `I agree that ${companyName || 'the company'} may keep the details and resume I send here to consider me for this and future openings, and that I can ask for them to be deleted at any time.`;

// ── Robot check (Cloudflare Turnstile) ────────────────────────────────────

const captchaSiteKey = () => String(process.env.CAREERS_TURNSTILE_SITE_KEY || '').trim() || null;
const captchaSecret = () => String(process.env.CAREERS_TURNSTILE_SECRET_KEY || '').trim() || null;
/** On when the server has both Turnstile keys; then every application must pass it. */
const captchaEnabled = () => Boolean(captchaSiteKey() && captchaSecret());

/** Did the visitor pass the robot check on one of the company's own websites? Fails closed. */
const verifyCaptcha = async (token, ip, allowedOrigins) => {
  if (!captchaEnabled()) return true;
  const value = String(token || '');
  if (!value || value.length > 2048) return false;
  try {
    const form = new URLSearchParams({ secret: captchaSecret(), response: value });
    if (ip) form.append('remoteip', ip);
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json();
    if (data?.success !== true) return false;
    // The check must have been solved on one of the company's websites.
    if (data.hostname) {
      const hosts = (allowedOrigins || []).map((o) => { try { return new URL(o).hostname; } catch { return null; } });
      if (!hosts.includes(String(data.hostname).toLowerCase())) return false;
    }
    return true;
  } catch (err) {
    logger.warn('[Careers] the robot check could not be verified', { error: err.message });
    return false;
  }
};

// ── Settings: the company's careers set-up ─────────────────────────────────

/**
 * "https://spaxads.com" from what HR typed ("spaxads.com", "https://spaxads.com/").
 * Only the address of a website: https (http only for localhost tests), no
 * path, no login. null when it isn't one.
 */
const normalizeOrigin = (value) => {
  const text = String(value || '').trim();
  if (!text || text.length > 200) return null;
  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') return null;
  const host = url.hostname.toLowerCase();
  const local = host === 'localhost' || host === '127.0.0.1';
  if (url.protocol === 'http:' && !local) return null;
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (!local && !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) return null;
  return `${url.protocol}//${url.host}`.toLowerCase();
};

/** How each optional field is asked: the stored choice, or the default. */
const formFieldsOf = (stored) => Object.fromEntries(Object.entries(FIELDS).map(([key, field]) => [
  key, stored && MODES.includes(stored[key]) ? stored[key] : field.default,
]));

const readSiteRow = async (companyId) => {
  const { data, error } = await supabaseAdmin
    .from('careers_sites')
    .select(SITE_COLUMNS)
    .eq('company_id', companyId)
    .maybeSingle();
  if (error) {
    if (isMissingTable(error)) throw notSetUp();
    throw new BadRequestError(error.message);
  }
  return data || null;
};

const companyNameOf = async (companyId) => {
  const { data } = await supabaseAdmin.from('companies').select('name').eq('id', companyId).maybeSingle();
  return data?.name || '';
};

/** What Settings → Recruitment → Careers website shows. */
const getSiteSettings = async (companyId) => {
  let row;
  try {
    row = await readSiteRow(companyId);
  } catch (err) {
    if (err.code === 'NOT_SET_UP') return { available: false, sqlFile: SQL_FILE };
    throw err;
  }
  const companyName = await companyNameOf(companyId);
  return {
    available: true,
    enabled: Boolean(row?.enabled),
    siteKey: row?.site_key || null,
    allowedOrigins: Array.isArray(row?.allowed_origins) ? row.allowed_origins : [],
    formFields: formFieldsOf(row?.form_fields),
    fieldLabels: Object.fromEntries(Object.entries(FIELDS).map(([key, field]) => [key, field.label])),
    consentText: row?.consent_text || null,
    defaultConsentText: defaultConsentText(companyName),
    dailyLimit: row?.daily_limit || DEFAULT_DAILY_LIMIT,
    captcha: captchaEnabled(),
    updatedAt: row?.updated_at || null,
  };
};

// Public look-ups by key, kept briefly; changed set-ups drop out at once.
const siteCache = new Map();
const forgetCompany = (companyId) => {
  for (const [key, entry] of siteCache) {
    if (!entry.value || entry.value.companyId === companyId) siteCache.delete(key);
  }
};

/** Saves the set-up (HR / Admin). Creates the careers key the first time. */
const saveSiteSettings = async (companyId, body = {}, updatedBy = null) => {
  const before = await readSiteRow(companyId);
  const next = {
    company_id: companyId,
    enabled: before?.enabled ?? false,
    site_key: before?.site_key || newSiteKey(),
    allowed_origins: Array.isArray(before?.allowed_origins) ? before.allowed_origins : [],
    form_fields: formFieldsOf(before?.form_fields),
    consent_text: before?.consent_text || null,
    daily_limit: before?.daily_limit || DEFAULT_DAILY_LIMIT,
    updated_by: updatedBy,
    updated_at: new Date().toISOString(),
  };

  if (body.enabled !== undefined) {
    if (typeof body.enabled !== 'boolean') throw new BadRequestError('enabled must be true or false');
    next.enabled = body.enabled;
  }
  if (body.allowedOrigins !== undefined) {
    if (!Array.isArray(body.allowedOrigins)) throw new BadRequestError('allowedOrigins must be a list of website addresses');
    if (body.allowedOrigins.length > MAX_ORIGINS) throw new BadRequestError(`Add at most ${MAX_ORIGINS} websites`);
    const origins = [];
    for (const value of body.allowedOrigins) {
      const origin = normalizeOrigin(value);
      if (!origin) {
        throw new BadRequestError(`"${String(value).slice(0, 80)}" isn't a website address. Enter it like https://spaxads.com (https, no page path).`);
      }
      if (!origins.includes(origin)) origins.push(origin);
    }
    next.allowed_origins = origins;
  }
  if (body.formFields !== undefined) {
    if (!body.formFields || typeof body.formFields !== 'object' || Array.isArray(body.formFields)) {
      throw new BadRequestError('formFields must be an object');
    }
    for (const [key, mode] of Object.entries(body.formFields)) {
      if (!FIELDS[key]) throw new BadRequestError(`Unknown form field: ${String(key).slice(0, 40)}`);
      if (!MODES.includes(mode)) throw new BadRequestError(`${FIELDS[key].label} must be required, optional or hidden`);
    }
    next.form_fields = formFieldsOf({ ...next.form_fields, ...body.formFields });
  }
  if (body.consentText !== undefined) {
    const consent = String(body.consentText ?? '').replace(CONTROL_CHARS, '').trim();
    if (consent && (consent.length < 20 || consent.length > 1000)) {
      throw new BadRequestError('The consent text must be 20 to 1000 characters');
    }
    next.consent_text = consent || null;
  }
  if (body.dailyLimit !== undefined) {
    const limit = Number(body.dailyLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 5000) throw new BadRequestError('The daily limit must be a whole number from 1 to 5000');
    next.daily_limit = limit;
  }
  if (next.enabled && !next.allowed_origins.length) {
    throw new BadRequestError('Add your website address first, e.g. https://spaxads.com');
  }

  const { error } = await supabaseAdmin.from('careers_sites').upsert(next, { onConflict: 'company_id' });
  if (error) {
    if (isMissingTable(error)) throw notSetUp();
    throw new BadRequestError(error.message);
  }
  forgetCompany(companyId);
  return { before, settings: await getSiteSettings(companyId) };
};

/** A new careers key: the old one stops working at once. */
const rotateSiteKey = async (companyId, updatedBy = null) => {
  const before = await readSiteRow(companyId);
  if (!before) return (await saveSiteSettings(companyId, {}, updatedBy)).settings;
  const { error } = await supabaseAdmin
    .from('careers_sites')
    .update({ site_key: newSiteKey(), updated_by: updatedBy, updated_at: new Date().toISOString() })
    .eq('company_id', companyId);
  if (error) throw new BadRequestError(error.message);
  forgetCompany(companyId);
  return getSiteSettings(companyId);
};

// ── Jobs' extra questions (saved with the job, recruitment.service.js) ─────

/** A job's extra questions, checked: [{ id, label, type, required, options }]. */
const normalizeQuestions = (input) => {
  if (input === undefined || input === null || input === '') return [];
  let list = input;
  if (typeof list === 'string') {
    try { list = JSON.parse(list); } catch { throw new BadRequestError('questions must be a list'); }
  }
  if (!Array.isArray(list)) throw new BadRequestError('questions must be a list');
  if (list.length > MAX_QUESTIONS) throw new BadRequestError(`Add at most ${MAX_QUESTIONS} questions to a job`);
  const ids = new Set();
  return list.map((raw, index) => {
    const q = raw && typeof raw === 'object' ? raw : {};
    const label = String(q.label ?? '').replace(CONTROL_CHARS, '').trim();
    if (!label || label.length > 200) throw new BadRequestError(`Question ${index + 1} needs a question of up to 200 characters`);
    const type = QUESTION_TYPES.includes(q.type) ? q.type : 'text';
    let id = String(q.id || '').trim();
    if (!/^q_[A-Za-z0-9_-]{4,32}$/.test(id) || ids.has(id)) id = `q_${crypto.randomBytes(6).toString('base64url')}`;
    ids.add(id);
    const question = { id, label, type, required: Boolean(q.required) };
    if (type === 'select') {
      const options = (Array.isArray(q.options) ? q.options : [])
        .map((o) => String(o ?? '').replace(CONTROL_CHARS, '').trim())
        .filter(Boolean);
      const unique = [...new Set(options)];
      if (unique.length < 2 || unique.length > 15 || unique.some((o) => o.length > 80)) {
        throw new BadRequestError(`Question ${index + 1} needs 2 to 15 choices of up to 80 characters`);
      }
      question.options = unique;
    }
    return question;
  });
};

// ── The public side ───────────────────────────────────────────────────────

/**
 * The company behind a careers key, when its set-up is on, the company is
 * active and its plan has Recruitment; otherwise null (the caller answers
 * "not found", whatever the reason).
 */
const resolveSite = async (key) => {
  const value = String(key || '');
  if (!KEY_PATTERN.test(value)) return null;
  const hit = siteCache.get(value);
  if (hit && hit.expires > Date.now()) return hit.value;

  const { data: row, error } = await supabaseAdmin
    .from('careers_sites')
    .select(SITE_COLUMNS)
    .eq('site_key', value)
    .maybeSingle();
  if (error) {
    if (isMissingTable(error)) throw notSetUp();
    throw new Error(error.message);
  }
  let site = null;
  if (row?.enabled) {
    const { data: company } = await supabaseAdmin
      .from('companies')
      .select('id, name, is_active')
      .eq('id', row.company_id)
      .maybeSingle();
    const featureOverride = require('./featureOverride.service');
    if (company && company.is_active !== false && (await featureOverride.hasFeature(company.id, 'recruitment'))) {
      site = {
        companyId: company.id,
        companyName: company.name || '',
        siteKey: row.site_key,
        allowedOrigins: Array.isArray(row.allowed_origins) ? row.allowed_origins : [],
        formFields: formFieldsOf(row.form_fields),
        consentText: row.consent_text || defaultConsentText(company.name),
        dailyLimit: row.daily_limit || DEFAULT_DAILY_LIMIT,
      };
    }
  }
  siteCache.set(value, { value: site, expires: Date.now() + SITE_CACHE_MS });
  return site;
};

/** May a page on this origin use the company's key? */
const isAllowedOrigin = (site, origin) => Boolean(origin && site?.allowedOrigins?.includes(origin));

const isLive = (row) => row
  && row.status === 'open'
  && row.show_on_website === true
  && (!row.closes_on || String(row.closes_on).slice(0, 10) >= todayIst());

const publicQuestions = (questions) => (Array.isArray(questions) ? questions : [])
  .filter((q) => q && q.id && q.label)
  .map((q) => ({
    id: q.id,
    label: q.label,
    type: QUESTION_TYPES.includes(q.type) ? q.type : 'text',
    required: Boolean(q.required),
    ...(q.type === 'select' ? { options: Array.isArray(q.options) ? q.options : [] } : {}),
  }));

const numberOrNull = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

/** What a website may show about a job, and nothing more. */
const publicJob = (row, { full = false } = {}) => {
  const salaryShown = row.show_salary === true && (row.salary_min != null || row.salary_max != null);
  return {
    id: row.id,
    title: row.title,
    department: row.department || null,
    location: row.location || null,
    employmentType: row.employment_type || 'full_time',
    workMode: row.work_mode || null,
    labels: {
      employmentType: EMPLOYMENT_LABELS[row.employment_type] || EMPLOYMENT_LABELS.full_time,
      workMode: WORK_MODE_LABELS[row.work_mode] || null,
    },
    summary: row.summary || null,
    experience: row.experience_min != null || row.experience_max != null
      ? { min: numberOrNull(row.experience_min), max: numberOrNull(row.experience_max) }
      : null,
    salary: salaryShown
      ? {
        min: numberOrNull(row.salary_min),
        max: numberOrNull(row.salary_max),
        currency: row.salary_currency || 'INR',
        period: row.salary_period || 'year',
      }
      : null,
    skills: Array.isArray(row.skills) ? row.skills.filter((s) => typeof s === 'string') : [],
    openings: Number(row.openings) || 1,
    postedOn: row.created_at ? String(row.created_at).slice(0, 10) : null,
    closesOn: row.closes_on ? String(row.closes_on).slice(0, 10) : null,
    ...(full ? { description: sanitizeJobHtml(row.description), questions: publicQuestions(row.questions) } : {}),
  };
};

const readJobs = async (site) => {
  const { data, error } = await supabaseAdmin
    .from('job_openings')
    .select(PUBLIC_JOB_COLUMNS)
    .eq('company_id', site.companyId)
    .eq('status', 'open')
    .eq('show_on_website', true)
    .order('created_at', { ascending: false })
    .limit(MAX_JOBS);
  if (error) {
    if (isMissingColumnError(error.message, 'show_on_website')) throw notSetUp();
    throw new Error(error.message);
  }
  return (data || []).filter(isLive);
};

const readJob = async (site, jobId) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(jobId || ''))) return null;
  const { data, error } = await supabaseAdmin
    .from('job_openings')
    .select(PUBLIC_JOB_COLUMNS)
    .eq('id', jobId)
    .eq('company_id', site.companyId)
    .maybeSingle();
  if (error) {
    if (isMissingColumnError(error.message, 'show_on_website')) throw notSetUp();
    throw new Error(error.message);
  }
  return isLive(data) ? data : null;
};

/** The application form a website shows: the fields asked, the consent, the robot check, the resume rules. */
const publicForm = (site) => ({
  fields: Object.fromEntries(Object.entries(site.formFields).filter(([, mode]) => mode !== 'hidden')),
  consentText: site.consentText,
  captcha: captchaEnabled() ? { provider: 'turnstile', siteKey: captchaSiteKey() } : null,
  resume: { types: RESUME_TYPES, maxMb: RESUME_MAX_MB },
});

const listPublicJobs = async (site) => ({
  company: { name: site.companyName },
  jobs: (await readJobs(site)).map((row) => publicJob(row)),
});

const getPublicJob = async (site, jobId) => {
  const row = await readJob(site, jobId);
  if (!row) throw new NotFoundError('This job is no longer open');
  return { company: { name: site.companyName }, job: publicJob(row, { full: true }), form: publicForm(site) };
};

// ── Applications ──────────────────────────────────────────────────────────

const clean = (value) => String(value ?? '').replace(CONTROL_CHARS, '').trim();
const isGiven = (value) => clean(value) !== '';

/** The candidate's answers to the job's questions, checked; problems go into `errors`. */
const readAnswers = (questions, rawAnswers, errors) => {
  let given = rawAnswers;
  if (typeof given === 'string') {
    try { given = JSON.parse(given); } catch { given = {}; }
  }
  if (!given || typeof given !== 'object' || Array.isArray(given)) given = {};
  const answers = [];
  for (const q of publicQuestions(questions)) {
    const raw = given[q.id];
    const value = Array.isArray(raw) ? clean(raw[0]) : clean(raw);
    if (!value) {
      if (q.required) errors[`answers.${q.id}`] = `Please answer: ${q.label}`;
      continue;
    }
    let answer = value;
    if (q.type === 'number') {
      const n = Number(value.replace(/,/g, ''));
      if (!Number.isFinite(n) || Math.abs(n) > 1e12) {
        errors[`answers.${q.id}`] = `Enter a number for: ${q.label}`;
        continue;
      }
      answer = String(n);
    } else if (q.type === 'yes_no') {
      const v = value.toLowerCase();
      if (v !== 'yes' && v !== 'no') {
        errors[`answers.${q.id}`] = `Answer yes or no for: ${q.label}`;
        continue;
      }
      answer = v === 'yes' ? 'Yes' : 'No';
    } else if (q.type === 'select') {
      if (!q.options.includes(value)) {
        errors[`answers.${q.id}`] = `Choose one of the options for: ${q.label}`;
        continue;
      }
    } else {
      const max = q.type === 'textarea' ? 2000 : 300;
      if (value.length > max) {
        errors[`answers.${q.id}`] = `Keep the answer to "${q.label}" under ${max} characters`;
        continue;
      }
    }
    answers.push({ questionId: q.id, question: q.label, answer });
  }
  return answers;
};

const readNumber = (value, { min, max, integer = false }) => {
  const n = Number(clean(value).replace(/,/g, ''));
  if (!Number.isFinite(n) || n < min || n > max) return null;
  if (integer && !Number.isInteger(n)) return null;
  return integer ? n : Math.round(n * 10) / 10;
};

const readUrl = (value) => {
  const text = clean(value);
  if (text.length > 300) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname.includes('.') || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
};

/**
 * Checks what the candidate filled in against the company's form: returns
 * the candidate's details, or throws one message with every problem in
 * `details.fields` (field name → what to fix).
 */
const readApplication = (site, job, body) => {
  const modes = site.formFields;
  const errors = {};
  const out = {};

  const name = clean(body.name).replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 120) errors.name = 'Enter your full name';
  out.name = name;

  const email = clean(body.email).toLowerCase();
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) errors.email = 'Enter a valid email address';
  out.email = email;

  const want = (key) => modes[key] !== 'hidden';
  const need = (key) => modes[key] === 'required';
  const missing = (key, message) => { if (need(key)) errors[key] = message; };

  if (want('phone')) {
    if (isGiven(body.phone)) {
      const problem = phoneProblem(clean(body.phone), 'Phone number');
      if (problem) errors.phone = problem;
      else out.phone = normalizePhone(clean(body.phone));
    } else missing('phone', 'Enter your phone number');
  }
  const textField = (key, column, max, message) => {
    if (!want(key)) return;
    if (!isGiven(body[key])) { missing(key, message); return; }
    const value = clean(body[key]);
    if (value.length > max) { errors[key] = `Keep this under ${max} characters`; return; }
    out[column] = value;
  };
  const numberField = (key, column, range, message) => {
    if (!want(key)) return;
    if (!isGiven(body[key])) { missing(key, message); return; }
    const n = readNumber(body[key], range);
    if (n === null) { errors[key] = message; return; }
    out[column] = n;
  };
  const urlField = (key, column, message) => {
    if (!want(key)) return;
    if (!isGiven(body[key])) { missing(key, message); return; }
    const url = readUrl(body[key]);
    if (!url) { errors[key] = message; return; }
    out[column] = url;
  };

  textField('currentLocation', 'current_location', 120, 'Enter your current city');
  numberField('experienceYears', 'experience_years', { min: 0, max: 60 }, 'Enter your total experience in years (0–60)');
  textField('currentCompany', 'current_company', 120, 'Enter your current company');
  numberField('currentCtc', 'current_ctc', { min: 0, max: 1e11 }, 'Enter your current salary as a number');
  numberField('expectedCtc', 'expected_ctc', { min: 0, max: 1e11 }, 'Enter your expected salary as a number');
  numberField('noticePeriodDays', 'notice_period_days', { min: 0, max: 365, integer: true }, 'Enter your notice period in days (0–365)');
  urlField('linkedinUrl', 'linkedin_url', 'Enter your LinkedIn profile address');
  urlField('portfolioUrl', 'portfolio_url', 'Enter your portfolio or website address');
  textField('coverNote', 'cover_note', 3000, 'Tell us briefly why you are a good fit');

  out.answers = readAnswers(job.questions, body.answers, errors);

  const consent = clean(body.consent).toLowerCase();
  if (!['true', 'on', 'yes', '1'].includes(consent)) errors.consent = 'Please tick the box to agree before you apply';

  if (Object.keys(errors).length) {
    throw new BadRequestError(Object.values(errors)[0], { fields: errors });
  }
  return out;
};

/** Website applications the company received today (India time), for its daily limit. */
const countToday = async (companyId) => {
  const start = moment().tz(TIMEZONE).startOf('day').toISOString();
  const { data, count, error } = await supabaseAdmin
    .from('candidates')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .eq('source', 'website')
    .gte('created_at', start);
  if (error) throw new Error(error.message);
  return typeof count === 'number' ? count : (data || []).length;
};

const removeFile = async (path) => {
  try {
    const { STORAGE_BUCKETS } = require('../utils/constants');
    await supabaseAdmin.storage.from(STORAGE_BUCKETS.documents).remove([path]);
  } catch (err) {
    logger.warn('[Careers] could not remove an unused resume', { error: err.message });
  }
};

/** HR is told in SpaxSync (and by email, which also goes on WhatsApp); the candidate gets a confirmation. */
const announceApplication = (site, candidate, job, sourceDetail) => {
  runInBackground('careers: new application alerts', async () => {
    const { getHrEmailRecipients } = require('./emailRecipients.service');
    const notificationService = require('./notification.service');
    const emailService = require('./email.service');
    const recipients = await getHrEmailRecipients(site.companyId);
    if (recipients.length) {
      await notificationService.createNotifications(recipients.map((r) => ({
        user_id: r.id,
        type: 'RECRUITMENT',
        title: 'New job application',
        message: `${candidate.name} applied for ${job.title}${sourceDetail ? ` on ${sourceDetail}` : ''}.`,
        link: '/recruitment/candidates',
        // Name and job ride along for the WhatsApp copy (whatsappCatalog.js RECRUITMENT).
        meta: { candidate_id: candidate.id, job_id: job.id, candidate_name: candidate.name, job_title: job.title },
        // The dedicated email below goes instead of the generic copy.
        skipEmail: true,
      })));
      for (const recipient of recipients) {
        emailService.newApplicationEmail(recipient, candidate, { jobTitle: job.title, sourceDetail })
          .catch((err) => logger.warn('[Careers] new application email failed', { error: err.message }));
      }
    }
    if (candidate.email) {
      emailService.applicationReceivedEmail(candidate, { jobTitle: job.title, companyName: site.companyName })
        .catch((err) => logger.warn('[Careers] application received email failed', { error: err.message }));
    }
  });
};

/**
 * One application from a company's website. Returns { status: 'received' }
 * whether it was saved, was a repeat for the same job, or tripped the spam
 * trap, so a bot learns nothing.
 */
const submitApplication = async ({ site, jobId, body = {}, file = null, origin, ip }) => {
  const job = await readJob(site, jobId);
  if (!job) throw new NotFoundError('This job is no longer open');

  // The hidden spam-trap field: people never see it, bots fill it in.
  if (isGiven(body.company_website)) {
    logger.info('[Careers] spam trap filled; application dropped', { companyId: site.companyId });
    return { status: 'received' };
  }
  if (!(await verifyCaptcha(body['cf-turnstile-response'] || body.captchaToken, ip, site.allowedOrigins))) {
    throw new BadRequestError('Please complete the robot check and try again');
  }

  const details = readApplication(site, job, body);
  const resumeMode = site.formFields.resume;
  if (resumeMode === 'required' && !file) {
    throw new BadRequestError('Please attach your resume', { fields: { resume: 'Please attach your resume' } });
  }

  if ((await countToday(site.companyId)) >= site.dailyLimit) {
    throw new TooManyRequestsError('We are not taking more applications today. Please try again tomorrow.');
  }

  // A second application for the same job: keep the first, say "received".
  const { data: earlier, error: earlierError } = await supabaseAdmin
    .from('candidates')
    .select('id')
    .eq('company_id', site.companyId)
    .eq('job_id', job.id)
    .eq('email', details.email)
    .limit(1);
  if (earlierError) throw new Error(earlierError.message);
  if ((earlier || []).length) return { status: 'received' };

  let resumePath = null;
  if (file && resumeMode !== 'hidden') {
    const { uploadResume } = require('./storage.service');
    resumePath = (await uploadResume(file, site.companyId)).path;
  }

  const sourceDetail = origin ? new URL(origin).hostname : null;
  const now = new Date().toISOString();
  const row = {
    company_id: site.companyId,
    job_id: job.id,
    name: details.name,
    email: details.email,
    phone: details.phone || null,
    source: 'website',
    source_detail: sourceDetail,
    resume_url: resumePath,
    stage: 'applied',
    days_in_stage: 0,
    applied_on: todayIst(),
    current_location: details.current_location || null,
    experience_years: details.experience_years ?? null,
    current_company: details.current_company || null,
    current_ctc: details.current_ctc ?? null,
    expected_ctc: details.expected_ctc ?? null,
    ctc_currency: (details.current_ctc != null || details.expected_ctc != null) ? (job.salary_currency || 'INR') : null,
    notice_period_days: details.notice_period_days ?? null,
    linkedin_url: details.linkedin_url || null,
    portfolio_url: details.portfolio_url || null,
    cover_note: details.cover_note || null,
    answers: details.answers,
    consent_at: now,
    consent_text: site.consentText,
  };
  const { data: candidate, error } = await supabaseAdmin
    .from('candidates')
    .insert(row)
    .select('id, name, email, company_id, job_id')
    .single();
  if (error) {
    if (resumePath) await removeFile(resumePath);
    throw new Error(error.message);
  }

  logger.info('[Careers] application received', { companyId: site.companyId, jobId: job.id, candidateId: candidate.id });
  announceApplication(site, candidate, job, sourceDetail);
  return { status: 'received' };
};

module.exports = {
  SQL_FILE,
  FIELDS,
  MODES,
  QUESTION_TYPES,
  RESUME_TYPES,
  RESUME_MAX_MB,
  normalizeOrigin,
  normalizeQuestions,
  formFieldsOf,
  defaultConsentText,
  captchaEnabled,
  getSiteSettings,
  saveSiteSettings,
  rotateSiteKey,
  resolveSite,
  isAllowedOrigin,
  listPublicJobs,
  getPublicJob,
  submitApplication,
  _resetForTests: () => siteCache.clear(),
};
