const { supabaseAdmin } = require('../config/supabase');
const { uploadDocument, getSignedUrl, deleteFile, STORAGE_BUCKETS } = require('../services/storage.service');
const { successResponse, paginate, buildMeta } = require('../utils/helpers');
const { BadRequestError, NotFoundError, ForbiddenError } = require('../utils/errors');
const notificationService = require('../services/notification.service');

const companyEmployeeIds = (req) => {
  const tenant = require('../services/tenant.service');
  const home = req.user.company_id;
  // Admin/HR manage the full org (main + subsidiaries)
  if (['admin', 'hr'].includes(req.user.role)) {
    return tenant.getOrgEmployeeIds(home);
  }
  return tenant.getCompanyEmployeeIds(home);
};

const requireCompanyDocument = async (req) => {
  const { data } = await supabaseAdmin
    .from('documents')
    .select('*')
    .eq('id', req.params.id)
    .maybeSingle();
  const ids = await companyEmployeeIds(req);
  if (!data || !ids.includes(data.employee_id)) throw new NotFoundError('Document not found');
  return data;
};

const upload = async (req, res, next) => {
  try {
    if (!req.file) throw new BadRequestError('File is required');

    const employeeId = req.body.employee_id || req.user.id;
    const isHrAdmin = ['hr', 'admin'].includes(req.user.role);
    if (employeeId !== req.user.id && !isHrAdmin) {
      throw new ForbiddenError('Not authorized to upload for another employee');
    }
    if (!(await companyEmployeeIds(req)).includes(employeeId)) {
      throw new NotFoundError('Employee not found');
    }

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
        is_verified: false,
      })
      .select('*, employee:employee_id(id, first_name, last_name, employee_code, email)')
      .single();

    if (error) throw new BadRequestError(error.message);

    // Notify HR/Admin pending verification
    const { data: hrs } = await supabaseAdmin
      .from('employees')
      .select('id, address')
      .in('role', ['hr', 'admin'])
      .eq('is_active', true);
    const ids = await companyEmployeeIds(req);
    for (const u of (hrs || []).filter((row) => ids.includes(row.id))) {
      await notificationService.createNotification({
        user_id: u.id,
        type: 'DOCUMENT',
        title: 'Document pending verification',
        message: `A document (${req.body.document_type}) was uploaded and needs verification.`,
        link: `/employees/${data.employee_id}?tab=documents`,
        meta: { document_id: data.id, employee_id: data.employee_id },
      });
    }

    successResponse(res, 'Document uploaded', data, null, 201);
  } catch (err) { next(err); }
};

const myDocuments = async (req, res, next) => {
  try {
    const { page, limit, offset } = paginate(req.query);
    const { data, error, count } = await supabaseAdmin
      .from('documents')
      .select('*, employee:employee_id(id, first_name, last_name, employee_code, email)', { count: 'exact' })
      .eq('employee_id', req.user.id)
      .order('uploaded_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw new BadRequestError(error.message);
    successResponse(res, 'Documents fetched', data, buildMeta(page, limit, count));
  } catch (err) { next(err); }
};

const allDocuments = async (req, res, next) => {
  try {
    const { page, limit, offset } = paginate(req.query);
    let query = supabaseAdmin
      .from('documents')
      .select('*, employee:employee_id(id, first_name, last_name, employee_code, email)')
      .order('uploaded_at', { ascending: false })
      .limit(5000);

    if (req.query.status === 'pending') query = query.eq('is_verified', false);
    if (req.query.status === 'verified') query = query.eq('is_verified', true);

    const { data, error } = await query;
    if (error) throw new BadRequestError(error.message);
    const ids = await companyEmployeeIds(req);
    const scoped = (data || []).filter((doc) => ids.includes(doc.employee_id));
    successResponse(
      res,
      'All documents fetched',
      scoped.slice(offset, offset + limit),
      buildMeta(page, limit, scoped.length)
    );
  } catch (err) { next(err); }
};

const employeeDocuments = async (req, res, next) => {
  try {
    const targetId = req.params.employeeId;
    const isOwner = targetId === req.user.id;
    const isHrAdmin = ['hr', 'admin'].includes(req.user.role);
    if (!isOwner && !isHrAdmin) {
      throw new ForbiddenError('Not authorized to view these documents');
    }
    if (!(await companyEmployeeIds(req)).includes(targetId)) {
      throw new NotFoundError('Employee not found');
    }

    const { data, error } = await supabaseAdmin
      .from('documents')
      .select('*')
      .eq('employee_id', targetId)
      .order('uploaded_at', { ascending: false });

    if (error) throw new BadRequestError(error.message);
    successResponse(res, 'Employee documents fetched', data);
  } catch (err) { next(err); }
};

const remove = async (req, res, next) => {
  try {
    const doc = await requireCompanyDocument(req);
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
    const doc = await requireCompanyDocument(req);
    if (doc.employee_id !== req.user.id && !['hr', 'admin'].includes(req.user.role)) {
      throw new ForbiddenError('Not authorized');
    }

    const url = await getSignedUrl(STORAGE_BUCKETS.documents, doc.document_url);
    // Default: redirect to signed file (works with cookie auth / window.open)
    if (req.query.format === 'json') {
      return successResponse(res, 'Download URL generated', { url, document: doc });
    }
    return res.redirect(302, url);
  } catch (err) { next(err); }
};

const verify = async (req, res, next) => {
  try {
    const doc = await requireCompanyDocument(req);
    if (doc.is_verified) throw new BadRequestError('Document is already verified');

    const { data, error } = await supabaseAdmin
      .from('documents')
      .update({
        is_verified: true,
        verified_by: req.user.id,
        verified_at: new Date().toISOString(),
      })
      .eq('id', req.params.id)
      .select('*, employee:employee_id(id, first_name, last_name, employee_code, email), verifier:verified_by(id, first_name, last_name)')
      .single();

    if (error) throw new BadRequestError(error.message);

    // Notify employee
    await notificationService.createNotification({
      user_id: doc.employee_id,
      type: 'DOCUMENT',
      title: 'Document verified',
      message: `Your document "${doc.document_name || doc.document_type}" has been verified.`,
      link: `/employees/${doc.employee_id}?tab=documents`,
      meta: { document_id: doc.id },
    });

    successResponse(res, 'Document verified', data);
  } catch (err) { next(err); }
};

module.exports = { upload, myDocuments, allDocuments, employeeDocuments, remove, download, verify };
