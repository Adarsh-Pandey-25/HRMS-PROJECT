const multer = require('multer');
const config = require('../config/database');
const { BadRequestError } = require('../utils/errors');

const storage = multer.memoryStorage();

const MIME_BY_EXTENSION = {
  pdf: ['application/pdf'],
  doc: ['application/msword'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  jpg: ['image/jpeg', 'image/jpg'],
  jpeg: ['image/jpeg', 'image/jpg'],
  png: ['image/png'],
};

const fileFilter = (req, file, cb) => {
  const name = String(file.originalname || '');
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  if (!config.upload.allowedTypes.includes(ext)) {
    return cb(new BadRequestError(`File type .${ext} not allowed`), false);
  }
  const allowedMimes = MIME_BY_EXTENSION[ext] || [];
  const mime = String(file.mimetype || '').toLowerCase();
  if (allowedMimes.length && mime && mime !== 'application/octet-stream' && !allowedMimes.includes(mime)) {
    return cb(new BadRequestError('File content type does not match its extension'), false);
  }
  cb(null, true);
};

const upload = multer({
  storage,
  limits: {
    fileSize: config.upload.maxFileSize,
    files: 10,
    fields: 50,
    parts: 60,
  },
  fileFilter,
});

/** Parse multipart only when a logo is attached; leave JSON bodies alone. */
const optionalLogoUpload = (req, res, next) => {
  const contentType = String(req.headers['content-type'] || '');
  if (!contentType.includes('multipart/form-data')) return next();
  return upload.single('logo')(req, res, next);
};

const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return next(new BadRequestError('File size exceeds limit'));
    }
    return next(new BadRequestError(err.message));
  }
  next(err);
};

module.exports = { upload, handleMulterError, optionalLogoUpload };
