const multer = require('multer');
const config = require('../config/database');
const { BadRequestError } = require('../utils/errors');

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const ext = file.originalname.split('.').pop().toLowerCase();
  if (!config.upload.allowedTypes.includes(ext)) {
    return cb(new BadRequestError(`File type .${ext} not allowed`), false);
  }
  cb(null, true);
};

const upload = multer({
  storage,
  limits: { fileSize: config.upload.maxFileSize },
  fileFilter,
});

const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return next(new BadRequestError('File size exceeds limit'));
    }
    return next(new BadRequestError(err.message));
  }
  next(err);
};

module.exports = { upload, handleMulterError };
