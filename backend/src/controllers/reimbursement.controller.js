const { supabaseAdmin } = require('../config/supabase');
const { uploadReceipt, getSignedUrl, STORAGE_BUCKETS } = require('../services/storage.service');
const attendanceService = require('../services/attendance.service');
const settingsService = require('../services/settings.service');
const { successResponse, paginate, buildMeta } = require('../utils/helpers');
const { BadRequestError, NotFoundError, ForbiddenError } = require('../utils/errors');
const notificationService = require('../services/notification.service');

const companyEmployeeIds = (req) =>
  require('../services/tenant.service').getCompanyEmployeeIds(req.user.company_id);

const requireCompanyReimbursement = async (req) => {
  const { data } = await supabaseAdmin
    .from('reimbursements')
    .select('*')
    .eq('id', req.params.id)
    .maybeSingle();
  const ids = await companyEmployeeIds(req);
  if (!data || !ids.includes(data.employee_id)) {
    throw new NotFoundError('Reimbursement not found');
  }
  return data;
};

const submit = async (req, res, next) => {
  try {
    const amount = Number(req.body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestError('Enter a valid amount');
    }

    const cfg = await settingsService.getSetting('expense_config', null, req.user.company_id);
    const requireReceiptAbove = Number(
      (cfg && typeof cfg === 'object'
        ? (cfg.requireReceiptAbove ?? cfg.require_receipt_above)
        : null) ?? 500,
    );
    if (Number.isFinite(requireReceiptAbove) && amount > requireReceiptAbove && !req.file) {
      throw new BadRequestError(
        `Receipt required for claims above ₹${requireReceiptAbove.toLocaleString('en-IN')}`,
      );
    }

    let receiptUrl = null;
    if (req.file) {
      const { path } = await uploadReceipt(req.file, req.user.id);
      receiptUrl = path;
    }

    const { data, error } = await supabaseAdmin
      .from('reimbursements')
      .insert({
        employee_id: req.user.id,
        reimbursement_type: req.body.reimbursement_type,
        amount,
        description: req.body.description,
        expense_date: req.body.expense_date,
        receipt_url: receiptUrl,
      })
      .select()
      .single();

    if (error) throw new BadRequestError(error.message);

    // Notify manager (if any) else HR/Admin
    const { data: employee } = await supabaseAdmin
      .from('employees')
      .select('id, first_name, last_name, manager_id')
      .eq('id', req.user.id)
      .single();

    if (employee?.manager_id) {
      await notificationService.createNotification({
        user_id: employee.manager_id,
        type: 'REIMBURSEMENT',
        title: 'Reimbursement pending approval',
        message: `${employee.first_name} ${employee.last_name} submitted a reimbursement claim (₹${req.body.amount}).`,
        link: '/expenses/approvals',
        meta: { reimbursement_id: data.id },
      });
    } else {
      const { data: hrs } = await supabaseAdmin
        .from('employees')
        .select('id, address')
        .in('role', ['hr', 'admin'])
        .eq('is_active', true);
      const ids = await companyEmployeeIds(req);
      for (const u of (hrs || []).filter((row) => ids.includes(row.id))) {
        await notificationService.createNotification({
          user_id: u.id,
          type: 'REIMBURSEMENT',
          title: 'Reimbursement submitted',
          message: `A reimbursement claim was submitted and needs review.`,
          link: '/expenses/all',
          meta: { reimbursement_id: data.id },
        });
      }
    }

    successResponse(res, 'Reimbursement submitted', data, null, 201);
  } catch (err) { next(err); }
};

const listReimbursements = async (filters, query) => {
  const { page, limit, offset } = paginate(query);
  let dbQuery = supabaseAdmin
    .from('reimbursements')
    .select('*, employee:employee_id(id, first_name, last_name, employee_code)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (filters.employee_id) dbQuery = dbQuery.eq('employee_id', filters.employee_id);
  if (filters.employee_ids) dbQuery = dbQuery.in('employee_id', filters.employee_ids);
  if (filters.status) dbQuery = dbQuery.eq('status', filters.status);

  const { data, error, count } = await dbQuery;
  if (error) throw new BadRequestError(error.message);
  return { data, meta: buildMeta(page, limit, count) };
};

const myReimbursements = async (req, res, next) => {
  try {
    const result = await listReimbursements({ employee_id: req.user.id }, req.query);
    successResponse(res, 'Reimbursements fetched', result.data, result.meta);
  } catch (err) { next(err); }
};

const teamReimbursements = async (req, res, next) => {
  try {
    const teamIds = await attendanceService.getTeamEmployeeIds(req.user.id);
    const result = await listReimbursements({ employee_ids: teamIds }, req.query);
    successResponse(res, 'Team reimbursements fetched', result.data, result.meta);
  } catch (err) { next(err); }
};

const allReimbursements = async (req, res, next) => {
  try {
    const filters = { employee_ids: await companyEmployeeIds(req) };
    if (req.query.status) filters.status = req.query.status;
    const result = await listReimbursements(filters, req.query);
    successResponse(res, 'All reimbursements fetched', result.data, result.meta);
  } catch (err) { next(err); }
};

const approve = async (req, res, next) => {
  try {
    const reimbursement = await requireCompanyReimbursement(req);

    if (req.user.role === 'manager') {
      const teamIds = await attendanceService.getTeamEmployeeIds(req.user.id);
      if (!teamIds.includes(reimbursement.employee_id)) {
        throw new ForbiddenError('Not authorized to approve this reimbursement');
      }
    }

    // Workflow:
    // - Manager: records manager approval (does not finalize)
    // - HR/Admin: final approval (optionally after manager approval if employee has a manager)
    let updates;
    if (req.user.role === 'manager') {
      updates = { manager_approved_by: req.user.id, manager_approved_at: new Date().toISOString() };
    } else {
      const { data: employee } = await supabaseAdmin
        .from('employees')
        .select('manager_id')
        .eq('id', reimbursement.employee_id)
        .single();

      if (employee?.manager_id && !reimbursement.manager_approved_by) {
        throw new BadRequestError('Manager approval required before HR approval');
      }

      updates = { status: 'approved', approved_by: req.user.id, approval_date: new Date().toISOString() };
    }

    const { data, error } = await supabaseAdmin
      .from('reimbursements')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw new BadRequestError(error.message);

    if (req.user.role === 'manager') {
      // Notify HR/Admin for final approval
      const { data: hrs } = await supabaseAdmin
        .from('employees')
        .select('id, address')
        .in('role', ['hr', 'admin'])
        .eq('is_active', true);
      const ids = await companyEmployeeIds(req);
      for (const u of (hrs || []).filter((row) => ids.includes(row.id))) {
        await notificationService.createNotification({
          user_id: u.id,
          type: 'REIMBURSEMENT',
          title: 'Reimbursement needs HR approval',
          message: `Manager approved a reimbursement claim. Please review and approve/reject.`,
          link: '/expenses/all',
          meta: { reimbursement_id: reimbursement.id, employee_id: reimbursement.employee_id },
        });
      }
    } else {
      // Final approval by HR/Admin -> notify employee
      await notificationService.createNotification({
        user_id: reimbursement.employee_id,
        type: 'REIMBURSEMENT',
        title: 'Reimbursement approved',
        message: `Your reimbursement claim was approved.`,
        link: '/expenses/me',
        meta: { reimbursement_id: reimbursement.id },
      });
    }

    successResponse(res, 'Reimbursement approved', data);
  } catch (err) { next(err); }
};

const reject = async (req, res, next) => {
  try {
    const reimbursement = await requireCompanyReimbursement(req);
    if (req.user.role === 'manager') {
      const teamIds = await attendanceService.getTeamEmployeeIds(req.user.id);
      if (!teamIds.includes(reimbursement.employee_id)) {
        throw new ForbiddenError('Not authorized to reject this reimbursement');
      }
    }

    const { data, error } = await supabaseAdmin
      .from('reimbursements')
      .update({
        status: 'rejected',
        approved_by: req.user.id,
        approval_date: new Date().toISOString(),
        rejection_reason: req.body.rejection_reason,
      })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw new BadRequestError(error.message);

    await notificationService.createNotification({
      user_id: reimbursement.employee_id,
      type: 'REIMBURSEMENT',
      title: 'Reimbursement rejected',
      message: `Your reimbursement claim was rejected.${req.body.rejection_reason ? ` Reason: ${req.body.rejection_reason}` : ''}`,
      link: '/expenses/me',
      meta: { reimbursement_id: reimbursement.id },
    });

    successResponse(res, 'Reimbursement rejected', data);
  } catch (err) { next(err); }
};

const remove = async (req, res, next) => {
  try {
    const reimbursement = await requireCompanyReimbursement(req);
    if (reimbursement.employee_id !== req.user.id) throw new ForbiddenError('Not authorized');
    if (reimbursement.status !== 'pending') throw new BadRequestError('Only pending reimbursements can be deleted');

    await supabaseAdmin.from('reimbursements').delete().eq('id', req.params.id);
    successResponse(res, 'Reimbursement deleted');
  } catch (err) { next(err); }
};

const receipt = async (req, res, next) => {
  try {
    const reimbursement = await requireCompanyReimbursement(req);
    if (!reimbursement.receipt_url) throw new NotFoundError('Receipt not uploaded');

    // Access rules:
    // - Employee: can view own receipt
    // - Manager: can view team receipts
    // - HR/Admin: can view all receipts
    if (req.user.role === 'employee') {
      if (reimbursement.employee_id !== req.user.id) throw new ForbiddenError('Not authorized');
    } else if (req.user.role === 'manager') {
      const teamIds = await attendanceService.getTeamEmployeeIds(req.user.id);
      if (!teamIds.includes(reimbursement.employee_id)) throw new ForbiddenError('Not authorized');
    }

    const signedUrl = await getSignedUrl(STORAGE_BUCKETS.receipts, reimbursement.receipt_url, 3600);
    successResponse(res, 'Receipt URL generated', { url: signedUrl });
  } catch (err) { next(err); }
};

module.exports = {
  submit, myReimbursements, teamReimbursements, allReimbursements, approve, reject, remove, receipt,
};
