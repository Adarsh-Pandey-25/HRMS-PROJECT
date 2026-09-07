const { supabaseAdmin } = require('../config/supabase');
const { uploadDocument, getSignedUrl, deleteFile, STORAGE_BUCKETS } = require('../services/storage.service');
const { successResponse, paginate, buildMeta } = require('../utils/helpers');
const { BadRequestError, NotFoundError, ForbiddenError } = require('../utils/errors');
const notificationService = require('../services/notification.service');
const { logAudit } = require('../services/auditLog.service');
const logger = require('../utils/logger');

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

    const { data: targetEmployee } = await supabaseAdmin
      .from('employees')
      .select('company_id')
      .eq('id', employeeId)
      .maybeSingle();

    const basePayload = {
      employee_id: employeeId,
      document_type: req.body.document_type,
      document_name: req.body.document_name,
      document_url: path,
      uploaded_by: req.user.id,
      expires_at: req.body.expires_at || null,
      is_verified: false,
    };

    let { data, error } = await supabaseAdmin
      .from('documents')
      .insert({ ...basePayload, company_id: targetEmployee?.company_id || req.user.company_id })
      .select('*, employee:employee_id(id, first_name, last_name, employee_code, email)')
      .single();

    // The company_id migration hasn't landed in this environment yet — fall
    // back to inserting without it rather than failing every upload.
    if (error && isMissingCompanyIdColumn(error.message)) {
      ({ data, error } = await supabaseAdmin
        .from('documents')
        .insert(basePayload)
        .select('*, employee:employee_id(id, first_name, last_name, employee_code, email)')
        .single());
    }

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

    // Item 5: explicitly requested — self-service document uploads are an
    // employee self-action worth logging, not just HR/Admin writes.
    logAudit({
      companyId: targetEmployee?.company_id || req.user.company_id,
      actorId: req.user.id, actorRole: req.user.role,
      actionType: employeeId === req.user.id ? 'document.self_upload' : 'document.upload',
      targetType: 'document', targetId: data.id,
      afterState: { documentType: req.body.document_type, employeeId }, ipAddress: req.ip,
    }).catch((e) => logger.warn('Audit log failed', { error: e.message }));

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

/** True when the documents.company_id migration hasn't been applied in this environment yet. */
const isMissingCompanyIdColumn = (message) => /column .*company_id.* does not exist/i.test(message || '');

const allDocuments = async (req, res, next) => {
  try {
    const { page, limit, offset } = paginate(req.query);
    const tenant = require('../services/tenant.service');
    const home = req.user.company_id;
    const companyIds = ['admin', 'hr'].includes(req.user.role)
      ? await tenant.getOrgCompanyIds(home)
      : [home];

    let query = supabaseAdmin
      .from('documents')
      .select('*, employee:employee_id(id, first_name, last_name, employee_code, email)', { count: 'exact' })
      .in('company_id', companyIds)
      .order('uploaded_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (req.query.status === 'pending') query = query.eq('is_verified', false);
    if (req.query.status === 'verified') query = query.eq('is_verified', true);

    let { data, error, count } = await query;

    // The company_id migration hasn't landed in this environment yet — fall
    // back to the pre-migration behavior (scope by employee instead) rather
    // than hard-failing the whole admin documents view.
    if (error && isMissingCompanyIdColumn(error.message)) {
      const ids = await companyEmployeeIds(req);
      let fallbackQuery = supabaseAdmin
        .from('documents')
        .select('*, employee:employee_id(id, first_name, last_name, employee_code, email)')
        .order('uploaded_at', { ascending: false })
        .limit(5000);
      if (req.query.status === 'pending') fallbackQuery = fallbackQuery.eq('is_verified', false);
      if (req.query.status === 'verified') fallbackQuery = fallbackQuery.eq('is_verified', true);
      const fallback = await fallbackQuery;
      if (fallback.error) throw new BadRequestError(fallback.error.message);
      const scoped = (fallback.data || []).filter((doc) => ids.includes(doc.employee_id));
      return successResponse(
        res,
        'All documents fetched',
        scoped.slice(offset, offset + limit),
        buildMeta(page, limit, scoped.length),
      );
    }

    if (error) throw new BadRequestError(error.message);
    successResponse(res, 'All documents fetched', data || [], buildMeta(page, limit, count || 0));
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
    const isHrAdmin = ['hr', 'admin'].includes(req.user.role);
    // Self-service delete is scoped to documents the employee uploaded
    // themselves — an HR-uploaded document (offer letter, verified
    // certificate, etc.) living under their employee_id is not theirs to
    // remove just because it's about them. uploaded_by exists precisely to
    // key this distinction off of.
    const isOwnUpload = doc.employee_id === req.user.id && doc.uploaded_by === req.user.id;
    if (!isOwnUpload && !isHrAdmin) {
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
