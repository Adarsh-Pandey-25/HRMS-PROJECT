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

const offers = async (req, res, next) => {
  try {
    const data = await recruitmentService.listOffers(companyIdOf(req));
    successResponse(res, 'Offers fetched', data);
  } catch (err) { next(err); }
};

module.exports = { jobs, createJob, candidates, moveCandidate, interviews, offers };
