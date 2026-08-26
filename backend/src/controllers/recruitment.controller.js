const recruitmentService = require('../services/recruitment.service');
const { successResponse } = require('../utils/helpers');
const { getCompanyId } = require('../utils/tenant');

const companyIdOf = (req) => req.user.company_id || getCompanyId(req.user);

const jobs = async (req, res, next) => {
  try {
    const data = await recruitmentService.listJobs(req.query, companyIdOf(req));
    successResponse(res, 'Jobs fetched', data);
  } catch (err) { next(err); }
};

const createJob = async (req, res, next) => {
  try {
    const data = await recruitmentService.createJob(req.body, companyIdOf(req));
    successResponse(res, 'Job created', data, null, 201);
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
    successResponse(res, 'Interview scheduled', data, null, 201);
  } catch (err) { next(err); }
};

const updateInterviewOutcome = async (req, res, next) => {
  try {
    const data = await recruitmentService.updateInterviewOutcome(req.params.id, req.body, companyIdOf(req));
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
    successResponse(res, 'Offer created', data, null, 201);
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
    successResponse(res, 'Checklist updated', data);
  } catch (err) { next(err); }
};

module.exports = {
  jobs,
  createJob,
  candidates,
  createCandidate,
  candidateResume,
  moveCandidate,
  interviews,
  createInterview,
  updateInterviewOutcome,
  offers,
  createOffer,
  getChecklist,
  updateChecklistItem,
};
