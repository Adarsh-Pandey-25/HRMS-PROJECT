const express = require('express');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const careersPublicController = require('../controllers/careersPublic.controller');
const careersService = require('../services/careers.service');
const { getTrustedClientIp } = require('../utils/helpers');
const { BadRequestError, ForbiddenError, NotFoundError } = require('../utils/errors');

/**
 * The Careers API — public, called from companies' own websites with their
 * careers key (careers.service.js, CAREERS_API.md):
 *   GET  /api/public/careers/v1/jobs?key=…            open jobs on the website
 *   GET  /api/public/careers/v1/jobs/:id?key=…        one job, with its application form
 *   POST /api/public/careers/v1/jobs/:id/apply?key=…  an application (multipart, with the resume)
 *
 * app.js mounts it before the CSRF header check (a website's form can't send
 * that header, and there is no session here to protect) and skips the
 * app-wide CORS for it: this router allows exactly the websites the company
 * listed, per key. The key travels in the address so a browser's preflight
 * request carries it too.
 */

const router = express.Router();

const clientIp = (req) => getTrustedClientIp(req) || req.ip;
const limiter = (max, windowMs, message) => rateLimit({
  windowMs,
  max,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `careers:${clientIp(req)}`,
  message: { success: false, error: { code: 'RATE_LIMIT', message }, timestamp: new Date().toISOString() },
});
// Reading jobs: plenty for a visitor clicking around.
const readLimiter = limiter(120, 60 * 1000, 'Too many requests. Please wait a minute and try again.');
// Applying: a person applies a few times at most; a bot gets stopped here.
const applyLimiter = limiter(8, 60 * 60 * 1000, 'Too many applications from this network. Please try again later.');

/** "https://spaxads.com" from the Origin header; null when there is none. */
const originOf = (req) => {
  const raw = req.headers.origin;
  if (!raw || raw === 'null') return null;
  try {
    const url = new URL(raw);
    return `${url.protocol}//${url.host}`.toLowerCase();
  } catch {
    return 'invalid';
  }
};

/**
 * The company behind the key, and CORS for its own websites only. A page on
 * any other website is refused. Without an Origin header (a server or a
 * script, not a browser) jobs can still be read — they are public anyway —
 * but no application is accepted (see the controller).
 */
const careersSite = async (req, res, next) => {
  try {
    res.setHeader('Vary', 'Origin');
    const site = await careersService.resolveSite(req.query.key);
    if (!site) throw new NotFoundError('Unknown careers key, or applications through the website are switched off');
    const origin = originOf(req);
    const allowed = careersService.isAllowedOrigin(site, origin);
    if (origin && !allowed) {
      throw new ForbiddenError('This website is not allowed to use this careers key. Add it in SpaxSync: Settings → Recruitment → Careers website.');
    }
    if (allowed) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Max-Age', '600');
    }
    if (req.method === 'OPTIONS') return res.status(204).end();
    req.careersSite = site;
    req.careersOrigin = allowed ? origin : null;
    return next();
  } catch (err) {
    return next(err);
  }
};

const RESUME_MIMES = {
  pdf: ['application/pdf'],
  doc: ['application/msword'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
};

/** One resume (PDF, DOC or DOCX, up to 5 MB) and the form's text fields; the file's real contents are checked when it is stored. */
const resumeUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: careersService.RESUME_MAX_MB * 1024 * 1024,
    files: 1,
    fields: 40,
    parts: 41,
    fieldNameSize: 100,
    fieldSize: 16 * 1024,
  },
  fileFilter: (req, file, cb) => {
    if (file.fieldname !== 'resume') return cb(new BadRequestError('Only a resume can be attached'), false);
    const name = String(file.originalname || '');
    const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
    const mimes = RESUME_MIMES[ext];
    if (!mimes) return cb(new BadRequestError('Attach your resume as a PDF, DOC or DOCX file'), false);
    const mime = String(file.mimetype || '').toLowerCase();
    if (mime && mime !== 'application/octet-stream' && !mimes.includes(mime)) {
      return cb(new BadRequestError('The resume file does not match its type. Please attach a PDF, DOC or DOCX file'), false);
    }
    return cb(null, true);
  },
});

/** Multipart forms (with a resume) are read here; JSON bodies were already read by app.js. */
const readApplicationForm = (req, res, next) => {
  if (!String(req.headers['content-type'] || '').toLowerCase().includes('multipart/form-data')) return next();
  return resumeUpload.single('resume')(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      return next(new BadRequestError(err.code === 'LIMIT_FILE_SIZE'
        ? `The resume must be ${careersService.RESUME_MAX_MB} MB or smaller`
        : 'The form could not be read. Please check it and try again.'));
    }
    return next(err);
  });
};

router.options('/v1/*', readLimiter, careersSite);
router.get('/v1/jobs', readLimiter, careersSite, careersPublicController.jobs);
router.get('/v1/jobs/:id', readLimiter, careersSite, careersPublicController.job);
router.post('/v1/jobs/:id/apply', applyLimiter, careersSite, readApplicationForm, careersPublicController.apply);

module.exports = router;
