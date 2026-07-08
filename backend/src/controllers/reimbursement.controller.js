const { supabaseAdmin } = require('../config/supabase');
const { uploadReceipt, getSignedUrl, STORAGE_BUCKETS } = require('../services/storage.service');
const attendanceService = require('../services/attendance.service');
const settingsService = require('../services/settings.service');
const { successResponse, paginate, buildMeta } = require('../utils/helpers');
const { BadRequestError, NotFoundError, ForbiddenError } = require('../utils/errors');

const submit = async (req, res, next) => {
  try {
    let receiptUrl = null;
    if (req.file) {
      const { path } = await uploadReceipt(req.file, req.user.id);
      receiptUrl = path;
    }

    const startOfMonth = new Date(req.body.expense_date);
    startOfMonth.setDate(1);
    const { data: monthlyTotal } = await supabaseAdmin
      .from('reimbursements')
      .select('amount')
      .eq('employee_id', req.user.id)
      .gte('expense_date', startOfMonth.toISOString().split('T')[0])
      .neq('status', 'rejected');

    // Monthly reimbursement limit removed (no cap).

    const { data, error } = await supabaseAdmin
      .from('reimbursements')
      .insert({
        employee_id: req.user.id,
        reimbursement_type: req.body.reimbursement_type,
        amount: req.body.amount,
        description: req.body.description,
        expense_date: req.body.expense_date,
        receipt_url: receiptUrl,
      })
      .select()
      .single();

    if (error) throw new BadRequestError(error.message);
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
    const filters = {};
    if (req.query.status) filters.status = req.query.status;
    const result = await listReimbursements(filters, req.query);
    successResponse(res, 'All reimbursements fetched', result.data, result.meta);
  } catch (err) { next(err); }
};

const approve = async (req, res, next) => {
  try {
    const { data: reimbursement } = await supabaseAdmin
      .from('reimbursements')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (!reimbursement) throw new NotFoundError('Reimbursement not found');

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
    successResponse(res, 'Reimbursement approved', data);
  } catch (err) { next(err); }
};

const reject = async (req, res, next) => {
  try {
    const { data: reimbursement } = await supabaseAdmin
      .from('reimbursements')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (!reimbursement) throw new NotFoundError('Reimbursement not found');
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
    successResponse(res, 'Reimbursement rejected', data);
  } catch (err) { next(err); }
};

const remove = async (req, res, next) => {
  try {
    const { data: reimbursement } = await supabaseAdmin
      .from('reimbursements')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (!reimbursement) throw new NotFoundError('Reimbursement not found');
    if (reimbursement.employee_id !== req.user.id) throw new ForbiddenError('Not authorized');
    if (reimbursement.status !== 'pending') throw new BadRequestError('Only pending reimbursements can be deleted');

    await supabaseAdmin.from('reimbursements').delete().eq('id', req.params.id);
    successResponse(res, 'Reimbursement deleted');
  } catch (err) { next(err); }
};

module.exports = {
  submit, myReimbursements, teamReimbursements, allReimbursements, approve, reject, remove,
};
