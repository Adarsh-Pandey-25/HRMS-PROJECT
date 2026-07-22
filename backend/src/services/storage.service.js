const { v4: uuidv4 } = require('uuid');
const { supabaseAdmin } = require('../config/supabase');
const { STORAGE_BUCKETS } = require('../utils/constants');
const { BadRequestError } = require('../utils/errors');
const logger = require('../utils/logger');

const hasValidSignature = (file, ext) => {
  const b = file?.buffer;
  if (!Buffer.isBuffer(b) || b.length < 8) return false;
  if (ext === 'pdf') return b.subarray(0, 5).toString() === '%PDF-';
  if (ext === 'jpg' || ext === 'jpeg') return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (ext === 'png') {
    return b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (ext === 'webp') {
    return b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP';
  }
  if (ext === 'docx') return b[0] === 0x50 && b[1] === 0x4b; // ZIP container
  if (ext === 'doc') {
    return b.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
  }
  if (['mp4', 'mov', 'm4v'].includes(ext)) return b.subarray(4, 8).toString() === 'ftyp';
  if (ext === 'webm') return b.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  return false;
};

const uploadFile = async (bucket, file, folder = '') => {
  const ext = file.originalname.split('.').pop().toLowerCase();
  if (!hasValidSignature(file, ext)) {
    throw new BadRequestError('File content is invalid or does not match its extension');
  }
  const fileName = `${folder ? folder + '/' : ''}${uuidv4()}.${ext}`;

  const { data, error } = await supabaseAdmin.storage
    .from(bucket)
    .upload(fileName, file.buffer, {
      contentType: file.mimetype,
      upsert: false,
    });

  if (error) {
    logger.error('Storage upload failed', { bucket, error: error.message });
    throw new BadRequestError(`File upload failed: ${error.message}`);
  }

  return { path: data.path, bucket };
};

const signedUrlCache = new Map();

const getSignedUrl = async (bucket, path, expiresIn = 3600) => {
  const key = `${bucket}:${path}`;
  const cached = signedUrlCache.get(key);
  const now = Date.now();
  if (cached && cached.expiresAt > now + 60_000) {
    return cached.url;
  }

  const { data, error } = await supabaseAdmin.storage
    .from(bucket)
    .createSignedUrl(path, expiresIn);

  if (error) {
    throw new BadRequestError(`Failed to generate signed URL: ${error.message}`);
  }

  signedUrlCache.set(key, {
    url: data.signedUrl,
    expiresAt: now + expiresIn * 1000,
  });

  return data.signedUrl;
};

const deleteFile = async (bucket, path) => {
  const { error } = await supabaseAdmin.storage.from(bucket).remove([path]);
  if (error) {
    logger.warn('File delete failed', { bucket, path, error: error.message });
  }
};

const uploadDocument = (file, employeeId) =>
  uploadFile(STORAGE_BUCKETS.documents, file, employeeId);

const uploadReceipt = (file, employeeId) =>
  uploadFile(STORAGE_BUCKETS.receipts, file, employeeId);

const uploadTrainingMaterial = (file) =>
  uploadFile(STORAGE_BUCKETS.trainingMaterials, file);

const uploadCourseThumbnail = (file) =>
  uploadFile(STORAGE_BUCKETS.trainingMaterials, file, 'courses/thumbnails');

const uploadCourseVideo = (file, courseId) =>
  uploadFile(STORAGE_BUCKETS.courseVideos, file, `courses/${courseId}/videos`);

/** Prefer course-videos bucket; fall back to training-materials for older uploads. */
const resolveCourseVideoBucket = (pathOrKey) => {
  if (!pathOrKey) return STORAGE_BUCKETS.courseVideos;
  if (String(pathOrKey).startsWith('courses/') && !String(pathOrKey).includes('thumbnails')) {
    return STORAGE_BUCKETS.courseVideos;
  }
  return STORAGE_BUCKETS.trainingMaterials;
};

const uploadProfilePicture = (file, employeeId) =>
  uploadFile(STORAGE_BUCKETS.profilePictures, file, employeeId);

const uploadCompanyLogo = (file, companyId) =>
  uploadFile(STORAGE_BUCKETS.documents, file, `company-logos/${companyId}`);

const uploadPayslip = (buffer, employeeId, month, year) => {
  const fileName = `${employeeId}/${year}-${String(month).padStart(2, '0')}.pdf`;
  return supabaseAdmin.storage
    .from(STORAGE_BUCKETS.payslips)
    .upload(fileName, buffer, { contentType: 'application/pdf', upsert: true })
    .then(({ data, error }) => {
      if (error) throw new BadRequestError(`Payslip upload failed: ${error.message}`);
      return { path: data.path, bucket: STORAGE_BUCKETS.payslips };
    });
};

module.exports = {
  uploadFile,
  getSignedUrl,
  deleteFile,
  uploadDocument,
  uploadReceipt,
  uploadTrainingMaterial,
  uploadCourseThumbnail,
  uploadCourseVideo,
  uploadProfilePicture,
  uploadCompanyLogo,
  uploadPayslip,
  resolveCourseVideoBucket,
  STORAGE_BUCKETS,
};
