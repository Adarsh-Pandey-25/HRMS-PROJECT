const recruitmentService = require('../services/recruitment.service');
const careersService = require('../services/careers.service');
const { successResponse } = require('../utils/helpers');
const { auditFromRequest } = require('../services/auditLog.service');
const { getCompanyId } = require('../utils/tenant');
const { getBaseDomain } = require('../utils/host');

const companyIdOf = (req) => req.user.company_id || getCompanyId(req.user);

/** The address websites call for the Careers API (CAREERS_API.md). */
const careersApiBase = (req) => {
  const base = getBaseDomain();
  const origin = base ? `https://${base}` : `${req.protocol}://${req.get('host')}`;
  return `${origin}/api/public/careers/v1`;
};

/** What the audit log keeps of a careers set-up — never the key itself. */
const careersAuditState = (s) => (s ? {
  enabled: Boolean(s.enabled),
  allowedOrigins: s.allowedOrigins || s.allowed_origins || [],
  formFields: s.formFields || s.form_fields || {},
  dailyLimit: s.dailyLimit || s.daily_limit || null,
  customConsentText: Boolean(s.consentText || s.consent_text),
} : null);

const jobs = async (req, res, next) => {
  try {
    const data = await recruitmentService.listJobs(req.query, companyIdOf(req));
    successResponse(res, 'Jobs fetched', data);
  } catch (err) { next(err); }
};

const createJob = async (req, res, next) => {
  try {
    const data = await recruitmentService.createJob(req.body, companyIdOf(req));
        auditFromRequest(req, {
      actionType: 'recruitment.job.create', targetType: 'job', targetId: data?.id,
      afterState: { title: data?.title, department: data?.department, status: data?.status },
    });
    successResponse(res, 'Job created', data, null, 201);
  } catch (err) { next(err); }
};

const updateJob = async (req, res, next) => {
  try {
    const data = await recruitmentService.updateJob(req.params.id, req.body || {}, companyIdOf(req));
    auditFromRequest(req, {
      actionType: 'recruitment.job.update', targetType: 'job', targetId: req.params.id,
      afterState: { title: data?.title, status: data?.status, showOnWebsite: data?.show_on_website },
    });
    successResponse(res, 'Job updated', data);
  } catch (err) { next(err); }
};

/** Settings → Recruitment → Careers website. */
const careersSite = async (req, res, next) => {
  try {
    const data = await careersService.getSiteSettings(companyIdOf(req));
    successResponse(res, 'Careers website', { ...data, apiBase: careersApiBase(req) });
  } catch (err) { next(err); }
};

const saveCareersSite = async (req, res, next) => {
  try {
    const { before, settings } = await careersService.saveSiteSettings(companyIdOf(req), req.body || {}, req.user.id);
    auditFromRequest(req, {
      actionType: 'recruitment.careers_site.update', targetType: 'careers_site', targetId: companyIdOf(req),
      beforeState: careersAuditState(before), afterState: careersAuditState(settings),
    });
    successResponse(res, 'Careers website saved', { ...settings, apiBase: careersApiBase(req) });
  } catch (err) { next(err); }
};

/** A new careers key; the old one stops working at once. */
const rotateCareersKey = async (req, res, next) => {
  try {
    const settings = await careersService.rotateSiteKey(companyIdOf(req), req.user.id);
    auditFromRequest(req, {
      actionType: 'recruitment.careers_site.new_key', targetType: 'careers_site', targetId: companyIdOf(req),
      afterState: { newKey: true },
    });
    successResponse(res, 'New careers key created', { ...settings, apiBase: careersApiBase(req) });
  } catch (err) { next(err); }
};

const candidates = async (req, res, next) => {
  try {
    const data = await recruitmentService.listCandidates(req.query, companyIdOf(req));
    successResponse(res, 'Candidates fetched', data);
  } catch (err) { next(err); }
};

const createCandidate = async (req, res, next) => {
  try {
    const data = await recruitmentService.createCandidate(req.body, req.file, companyIdOf(req));
        auditFromRequest(req, {
      actionType: 'recruitment.candidate.create', targetType: 'candidate', targetId: data?.id,
      afterState: { name: data?.name, stage: data?.stage },
    });
    successResponse(res, 'Candidate created', data, null, 201);
  } catch (err) { next(err); }
};

const candidateResume = async (req, res, next) => {
  try {
    const url = await recruitmentService.getCandidateResumeUrl(req.params.id, companyIdOf(req));
    successResponse(res, 'Resume URL generated', { url });
  } catch (err) { next(err); }
};

const moveCandidate = async (req, res, next) => {
  try {
    const data = await recruitmentService.moveCandidate(req.params.id, req.body.stage, companyIdOf(req));
    if (!data) return res.status(404).json({ success: false, error: { message: 'Candidate not found' } });
        auditFromRequest(req, {
      actionType: 'recruitment.candidate.move', targetType: 'candidate', targetId: req.params.id,
      afterState: { stage: data?.stage, name: data?.name },
    });
    successResponse(res, 'Candidate updated', data);
  } catch (err) { next(err); }
};

const interviews = async (req, res, next) => {
  try {
    const data = await recruitmentService.listInterviews(companyIdOf(req));
    successResponse(res, 'Interviews fetched', data);
  } catch (err) { next(err); }
};

const createInterview = async (req, res, next) => {
  try {
    const data = await recruitmentService.createInterview(req.body, companyIdOf(req));
        auditFromRequest(req, {
      actionType: 'recruitment.interview.schedule', targetType: 'interview', targetId: data?.id,
      afterState: { candidateId: data?.candidate_id, scheduledAt: data?.scheduled_at },
    });
    successResponse(res, 'Interview scheduled', data, null, 201);
  } catch (err) { next(err); }
};

const updateInterviewOutcome = async (req, res, next) => {
  try {
    const data = await recruitmentService.updateInterviewOutcome(req.params.id, req.body, companyIdOf(req));
        auditFromRequest(req, {
      actionType: 'recruitment.interview.outcome', targetType: 'interview', targetId: req.params.id,
      afterState: { outcome: data?.outcome, status: data?.status },
    });
    successResponse(res, 'Interview updated', data);
  } catch (err) { next(err); }
};

const offers = async (req, res, next) => {
  try {
    const data = await recruitmentService.listOffers(companyIdOf(req));
    successResponse(res, 'Offers fetched', data);
  } catch (err) { next(err); }
};

const createOffer = async (req, res, next) => {
  try {
    const data = await recruitmentService.createOffer(req.body, companyIdOf(req));
        auditFromRequest(req, {
      actionType: 'recruitment.offer.create', targetType: 'offer', targetId: data?.id,
      afterState: { candidateId: data?.candidate_id, status: data?.status },
    });
    successResponse(res, 'Offer created', data, null, 201);
  } catch (err) { next(err); }
};

const updateOfferStatus = async (req, res, next) => {
  try {
    const data = await recruitmentService.updateOfferStatus(req.params.id, req.body.status, companyIdOf(req));
        auditFromRequest(req, {
      actionType: 'recruitment.offer.update', targetType: 'offer', targetId: req.params.id,
      afterState: { status: data?.status },
    });
    successResponse(res, 'Offer updated', data);
  } catch (err) { next(err); }
};

const getChecklist = async (req, res, next) => {
  try {
    const data = await recruitmentService.getCandidateChecklist(req.params.id, companyIdOf(req));
    successResponse(res, 'Checklist fetched', data);
  } catch (err) { next(err); }
};

const updateChecklistItem = async (req, res, next) => {
  try {
    const isChecked = Boolean(req.body?.is_checked ?? req.body?.isChecked);
    const data = await recruitmentService.setCandidateChecklistItem(
      req.params.id,
      req.params.templateId,
      isChecked,
      companyIdOf(req),
      req.user.id
    );
        auditFromRequest(req, {
      actionType: 'recruitment.checklist.update', targetType: 'onboarding_checklist', targetId: req.params.id,
    });
    successResponse(res, 'Checklist updated', data);
  } catch (err) { next(err); }
};

module.exports = {
  jobs,
  createJob,
  updateJob,
  careersSite,
  saveCareersSite,
  rotateCareersKey,
  candidates,
  createCandidate,
  candidateResume,
  moveCandidate,
  interviews,
  createInterview,
  updateInterviewOutcome,
  offers,
  createOffer,
  updateOfferStatus,
  getChecklist,
  updateChecklistItem,
};
