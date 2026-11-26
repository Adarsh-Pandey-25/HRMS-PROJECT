const careersService = require('../services/careers.service');
const { successResponse, getTrustedClientIp } = require('../utils/helpers');
const { ForbiddenError } = require('../utils/errors');

/**
 * The Careers API's answers (routes/careersPublic.routes.js has the key and
 * website checks). Job lists may be cached for a minute, so a change in
 * SpaxSync reaches the website within about a minute.
 */

const jobs = async (req, res, next) => {
  try {
    res.set('Cache-Control', 'public, max-age=60');
    successResponse(res, 'Open jobs', await careersService.listPublicJobs(req.careersSite));
  } catch (err) { next(err); }
};

const job = async (req, res, next) => {
  try {
    res.set('Cache-Control', 'public, max-age=60');
    successResponse(res, 'Job', await careersService.getPublicJob(req.careersSite, req.params.id));
  } catch (err) { next(err); }
};

const apply = async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    // Only from a page on one of the company's own websites.
    if (!req.careersOrigin) throw new ForbiddenError("Applications are accepted only from the company's own website");
    const result = await careersService.submitApplication({
      site: req.careersSite,
      jobId: req.params.id,
      body: req.body || {},
      file: req.file || null,
      origin: req.careersOrigin,
      ip: getTrustedClientIp(req) || req.ip,
    });
    successResponse(res, 'Thank you! Your application has been received.', result, null, 201);
  } catch (err) { next(err); }
};

module.exports = { jobs, job, apply };
