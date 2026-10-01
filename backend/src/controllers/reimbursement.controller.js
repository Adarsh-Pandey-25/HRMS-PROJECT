const { supabaseAdmin } = require('../config/supabase');
const { uploadReceipt, getSignedUrl, STORAGE_BUCKETS } = require('../services/storage.service');
const attendanceService = require('../services/attendance.service');
const settingsService = require('../services/settings.service');
const { successResponse, paginate, buildMeta } = require('../utils/helpers');
const { BadRequestError, NotFoundError, ForbiddenError } = require('../utils/errors');
const notificationService = require('../services/notification.service');
const approvalFlow = require('../services/approvalFlow.service');

const companyEmployeeIds = (req) => {
  const tenant = require('../services/tenant.service');
  const home = req.user.company_id;
  if (['admin', 'hr'].includes(req.user.role)) {
    return tenant.getOrgEmployeeIds(home);
  }
  return tenant.getCompanyEmployeeIds(home);
};

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
        company_id: req.user.company_id,
        reimbursement_type: req.body.reimbursement_type,
        amount,
        description: req.body.description,
        expense_date: req.body.expense_date,
        receipt_url: receiptUrl,
      })
      .select()
      .single();

    if (error) {
      // "accommodation" depends on a manual DB migration (ALTER TYPE ... ADD
      // VALUE) that may not have been run yet in a given environment — don't
      // leak the raw Postgres enum-violation text, which names the exact
      // column/type, to the browser.
      if (/invalid input value for enum/i.test(error.message || '')) {
        throw new BadRequestError('This expense category isn\'t available yet — contact your admin.');
      }
      throw new BadRequestError(error.message);
    }

    // Notify whoever acts first under Settings → Expenses → Approval flow:
    // the manager, or HR (HR only, or the employee has no manager).
    const { data: employee } = await supabaseAdmin
      .from('employees')
      .select('id, first_name, last_name, manager_id')
      .eq('id', req.user.id)
      .single();
    const flow = await approvalFlow.getExpenseFlow(req.user.company_id);
    const firstStage = approvalFlow.awaitingStage(flow, { hasManager: Boolean(employee?.manager_id), managerApproved: false });

    if (firstStage === 'manager') {
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
          link: '/expenses/approvals',
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
    .select('*, employee:employee_id(id, first_name, last_name, employee_code, manager_id)', { count: 'exact' })
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
    const teamIds = await attendanceService.getTeamEmployeeIds(req.user.id, req.user.company_id);
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

/** The facts the approval rules need about a claim and the person acting on it. */
const approvalContext = async (req, reimbursement) => {
  const { data: employee } = await supabaseAdmin
    .from('employees')
    .select('manager_id')
    .eq('id', reimbursement.employee_id)
    .maybeSingle();
  const managesEmployee = req.user.role === 'manager'
    ? (await attendanceService.getTeamEmployeeIds(req.user.id, req.user.company_id)).includes(reimbursement.employee_id)
    : false;
  return {
    flow: await approvalFlow.getExpenseFlow(req.user.company_id),
    actorId: req.user.id,
    employeeId: reimbursement.employee_id,
    actorRole: req.user.role,
    managesEmployee,
    hasManager: Boolean(employee?.manager_id),
    managerApproved: Boolean(reimbursement.manager_approved_by),
    what: 'expense claim',
  };
};

const approve = async (req, res, next) => {
  try {
    const reimbursement = await requireCompanyReimbursement(req);
    if (reimbursement.status !== 'pending') throw new BadRequestError('This claim has already been decided');

    // Settings → Expenses → Approval flow. This setting used to be ignored:
    // claims always went manager → HR whatever it said.
    const ctx = await approvalContext(req, reimbursement);
    const decision = approvalFlow.decideApproval(ctx.flow, ctx);
    if (!decision.ok) throw decision.status === 403 ? new ForbiddenError(decision.message) : new BadRequestError(decision.message);

    const now = new Date().toISOString();
    const managerStep = req.user.role === 'manager';
    let updates;
    if (managerStep && !decision.final) {
      updates = { manager_approved_by: req.user.id, manager_approved_at: now }; // HR finalizes
    } else if (managerStep) {
      updates = { manager_approved_by: req.user.id, manager_approved_at: now, status: 'approved', approved_by: req.user.id, approval_date: now };
    } else {
      updates = { status: 'approved', approved_by: req.user.id, approval_date: now };
    }

    const { data, error } = await supabaseAdmin
      .from('reimbursements')
      .update(updates)
      .eq('id', req.params.id)
      .eq('status', 'pending')
      .select()
      .maybeSingle();

    if (error) throw new BadRequestError(error.message);
    if (!data) throw new BadRequestError('This claim has already been decided');

    if (!decision.final) {
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
          link: '/expenses/approvals',
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
    if (reimbursement.status !== 'pending') throw new BadRequestError('This claim has already been decided');
    const ctx = await approvalContext(req, reimbursement);
    const rejection = approvalFlow.decideRejection(ctx.flow, ctx);
    if (!rejection.ok) throw new ForbiddenError(rejection.message);

    const { data, error } = await supabaseAdmin
      .from('reimbursements')
      .update({
        status: 'rejected',
        approved_by: req.user.id,
        approval_date: new Date().toISOString(),
        rejection_reason: req.body.rejection_reason,
      })
      .eq('id', req.params.id)
      .eq('status', 'pending')
      .select()
      .maybeSingle();

    if (error) throw new BadRequestError(error.message);
    if (!data) throw new BadRequestError('This claim has already been decided');

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
      const teamIds = await attendanceService.getTeamEmployeeIds(req.user.id, req.user.company_id);
      if (!teamIds.includes(reimbursement.employee_id)) throw new ForbiddenError('Not authorized');
    }

    const signedUrl = await getSignedUrl(STORAGE_BUCKETS.receipts, reimbursement.receipt_url, 3600);
    successResponse(res, 'Receipt URL generated', { url: signedUrl });
  } catch (err) { next(err); }
};

module.exports = {
  submit, myReimbursements, teamReimbursements, allReimbursements, approve, reject, remove, receipt,
};
