const multer = require('multer');
const { BadRequestError } = require('../utils/errors');

const MB = 1024 * 1024;
// Supabase Free tier max per file is 50 MB (Pro allows up to 500 GB)
const TRAINING_VIDEO_MAX_MB = parseInt(process.env.TRAINING_VIDEO_MAX_MB, 10) || 50;

const VIDEO_TYPES = ['mp4', 'webm', 'mov', 'm4v'];
const IMAGE_TYPES = ['jpg', 'jpeg', 'png', 'webp'];

const videoStorage = multer.memoryStorage();

const videoFileFilter = (req, file, cb) => {
  const ext = file.originalname.split('.').pop().toLowerCase();
  if (!VIDEO_TYPES.includes(ext)) {
    return cb(new BadRequestError(`Video type .${ext} not allowed`), false);
  }
  cb(null, true);
};

const imageFileFilter = (req, file, cb) => {
  const ext = file.originalname.split('.').pop().toLowerCase();
  if (!IMAGE_TYPES.includes(ext)) {
    return cb(new BadRequestError(`Image type .${ext} not allowed`), false);
  }
  cb(null, true);
};

const uploadVideo = multer({
  storage: videoStorage,
  limits: { fileSize: TRAINING_VIDEO_MAX_MB * MB },
  fileFilter: videoFileFilter,
});

const uploadThumbnail = multer({
  storage: videoStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: imageFileFilter,
});

module.exports = { uploadVideo, uploadThumbnail, VIDEO_TYPES, TRAINING_VIDEO_MAX_MB };
