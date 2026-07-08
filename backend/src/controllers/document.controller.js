const { supabaseAdmin } = require('../config/supabase');
const { uploadDocument, getSignedUrl, deleteFile, STORAGE_BUCKETS } = require('../services/storage.service');
const { successResponse, paginate, buildMeta } = require('../utils/helpers');
const { BadRequestError, NotFoundError, ForbiddenError } = require('../utils/errors');

const upload = async (req, res, next) => {
  try {
    if (!req.file) throw new BadRequestError('File is required');

    const employeeId = req.body.employee_id || req.user.id;
    const { path } = await uploadDocument(req.file, employeeId);

    const { data, error } = await supabaseAdmin
      .from('documents')
      .insert({
        employee_id: employeeId,
        document_type: req.body.document_type,
        document_name: req.body.document_name,
        document_url: path,
        uploaded_by: req.user.id,
        expires_at: req.body.expires_at || null,
      })
      .select()
      .single();

    if (error) throw new BadRequestError(error.message);
    successResponse(res, 'Document uploaded', data, null, 201);
  } catch (err) { next(err); }
};

const myDocuments = async (req, res, next) => {
  try {
    const { page, limit, offset } = paginate(req.query);
    const { data, error, count } = await supabaseAdmin
      .from('documents')
      .select('*', { count: 'exact' })
      .eq('employee_id', req.user.id)
      .order('uploaded_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw new BadRequestError(error.message);
    successResponse(res, 'Documents fetched', data, buildMeta(page, limit, count));
  } catch (err) { next(err); }
};

const employeeDocuments = async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('documents')
      .select('*')
      .eq('employee_id', req.params.employeeId)
      .order('uploaded_at', { ascending: false });

    if (error) throw new BadRequestError(error.message);
    successResponse(res, 'Employee documents fetched', data);
  } catch (err) { next(err); }
};

const remove = async (req, res, next) => {
  try {
    const { data: doc } = await supabaseAdmin
      .from('documents')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (!doc) throw new NotFoundError('Document not found');
    if (doc.employee_id !== req.user.id && !['hr', 'admin'].includes(req.user.role)) {
      throw new ForbiddenError('Not authorized');
    }

    await deleteFile(STORAGE_BUCKETS.documents, doc.document_url);
    await supabaseAdmin.from('documents').delete().eq('id', req.params.id);
    successResponse(res, 'Document deleted');
  } catch (err) { next(err); }
};

const download = async (req, res, next) => {
  try {
    const { data: doc } = await supabaseAdmin
      .from('documents')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (!doc) throw new NotFoundError('Document not found');
    if (doc.employee_id !== req.user.id && !['hr', 'admin'].includes(req.user.role)) {
      throw new ForbiddenError('Not authorized');
    }

    const url = await getSignedUrl(STORAGE_BUCKETS.documents, doc.document_url);
    successResponse(res, 'Download URL generated', { url, document: doc });
  } catch (err) { next(err); }
};

module.exports = { upload, myDocuments, employeeDocuments, remove, download };
