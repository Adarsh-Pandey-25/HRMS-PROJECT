const recruitmentService = require('../services/recruitment.service');
const { successResponse } = require('../utils/helpers');

const jobs = async (req, res, next) => {
  try {
    const data = await recruitmentService.listJobs(req.query);
    successResponse(res, 'Jobs fetched', data);
  } catch (err) { next(err); }
};

const createJob = async (req, res, next) => {
  try {
    const data = await recruitmentService.createJob(req.body);
    successResponse(res, 'Job created', data, null, 201);
  } catch (err) { next(err); }
};

const candidates = async (req, res, next) => {
  try {
    const data = await recruitmentService.listCandidates(req.query);
    successResponse(res, 'Candidates fetched', data);
  } catch (err) { next(err); }
};

const moveCandidate = async (req, res, next) => {
  try {
    const data = await recruitmentService.moveCandidate(req.params.id, req.body.stage);
    if (!data) return res.status(404).json({ success: false, error: { message: 'Candidate not found' } });
    successResponse(res, 'Candidate updated', data);
  } catch (err) { next(err); }
};

const interviews = async (req, res, next) => {
  try {
    const data = await recruitmentService.listInterviews();
    successResponse(res, 'Interviews fetched', data);
  } catch (err) { next(err); }
};

const offers = async (req, res, next) => {
  try {
    const data = await recruitmentService.listOffers();
    successResponse(res, 'Offers fetched', data);
  } catch (err) { next(err); }
};

module.exports = { jobs, createJob, candidates, moveCandidate, interviews, offers };
