const { v4: uuidv4 } = require('uuid');
const { supabaseAdmin } = require('../config/supabase');
const { STORAGE_BUCKETS } = require('../utils/constants');
const { BadRequestError } = require('../utils/errors');
const logger = require('../utils/logger');

const uploadFile = async (bucket, file, folder = '') => {
  const ext = file.originalname.split('.').pop().toLowerCase();
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

const getSignedUrl = async (bucket, path, expiresIn = 3600) => {
  const { data, error } = await supabaseAdmin.storage
    .from(bucket)
    .createSignedUrl(path, expiresIn);

  if (error) {
    throw new BadRequestError(`Failed to generate signed URL: ${error.message}`);
  }

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

const uploadProfilePicture = (file, employeeId) =>
  uploadFile(STORAGE_BUCKETS.profilePictures, file, employeeId);

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
  uploadProfilePicture,
  uploadPayslip,
  STORAGE_BUCKETS,
};
