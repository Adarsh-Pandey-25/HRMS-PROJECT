const { supabaseAdmin } = require('../config/supabase');
const attendanceService = require('../services/attendance.service');
const tenantService = require('../services/tenant.service');
const reportsService = require('../services/reports.service');
const { successResponse } = require('../utils/helpers');
const { BadRequestError } = require('../utils/errors');

/**
 * Manager-and-above report scope (plain Employees never reach these controllers —
 * the routes are gated by isManagerOrAbove):
 * - HR/Admin: the whole company, optionally narrowed to one department via ?department=
 * - Manager: only their own direct reports (getTeamEmployeeIds) — department filter
 *   does not widen this, since a manager's team is already the scope ceiling.
 * Never trust a client-supplied company id here — company_id always comes from
 * the authenticated req.user, never from the query string.
 */
const resolveReportScope = async (req) => {
  if (['admin', 'hr'].includes(req.user.role)) {
    let ids = await tenantService.getCompanyEmployeeIds(req.user.company_id);
    const department = req.query.department ? String(req.query.department).trim() : null;
    if (department && ids.length) {
      const { data, error } = await supabaseAdmin
        .from('employees')
        .select('id')
        .in('id', ids)
        .eq('department', department);
      if (error) throw new BadRequestError(error.message);
      ids = (data || []).map((e) => e.id);
    }
    return ids;
  }
  return attendanceService.getTeamEmployeeIds(req.user.id);
};

const isValidDateString = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) && !Number.isNaN(new Date(value).getTime());

// Manager "team performance" = monthly attendance + leave + reimbursement summaries for team.
const teamPerformance = async (req, res, next) => {
  try {
    const month = parseInt(req.query.month, 10);
    const year = parseInt(req.query.year, 10);
    if (!month || !year) throw new BadRequestError('month and year are required');

    const teamIds = await resolveReportScope(req);
    if (!teamIds.length) return successResponse(res, 'Team performance report fetched', []);

    // Each team member's four lookups (and each team member vs. the others) are
    // independent — run them concurrently instead of awaiting one at a time in a loop.
    // Promise.all (not allSettled): a lookup failing here already meant the whole
    // request failed under the old sequential code, so we keep that behavior.
    const summaries = await Promise.all(teamIds.map(async (employeeId) => {
      const [{ data: employee }, attendance, { data: leaves }, { data: reimbursements }] = await Promise.all([
        supabaseAdmin
          .from('employees')
          .select('id, employee_code, first_name, last_name, department, designation')
          .eq('id', employeeId)
          .single(),
        attendanceService.getMonthlySummary(employeeId, month, year),
        supabaseAdmin
          .from('leaves')
          .select('id,status,total_days')
          .eq('employee_id', employeeId)
          .gte('from_date', `${year}-${String(month).padStart(2, '0')}-01`)
          .lte('to_date', `${year}-${String(month).padStart(2, '0')}-31`),
        supabaseAdmin
          .from('reimbursements')
          .select('id,status,amount,expense_date')
          .eq('employee_id', employeeId)
          .gte('expense_date', `${year}-${String(month).padStart(2, '0')}-01`)
          .lte('expense_date', `${year}-${String(month).padStart(2, '0')}-31`),
      ]);

      return {
        employee,
        attendance: attendance.summary,
        leaves: {
          total: (leaves || []).length,
          pending: (leaves || []).filter((l) => l.status === 'pending').length,
          approvedDays: (leaves || []).filter((l) => l.status === 'approved').reduce((s, l) => s + Number(l.total_days || 0), 0),
        },
        reimbursements: {
          total: (reimbursements || []).length,
          pending: (reimbursements || []).filter((r) => r.status === 'pending').length,
          totalAmount: (reimbursements || []).reduce((s, r) => s + Number(r.amount || 0), 0),
        },
      };
    }));

    successResponse(res, 'Team performance report fetched', summaries);
  } catch (err) {
    next(err);
  }
};

// Attendance Summary — per-employee present/absent/late/half-day/leave-days + hours over a date range.
const attendanceSummary = async (req, res, next) => {
  try {
    const { from, to } = req.query;
    if (!isValidDateString(from) || !isValidDateString(to)) {
      throw new BadRequestError('from and to are required (YYYY-MM-DD)');
    }
    if (String(from) > String(to)) throw new BadRequestError('from must be on or before to');

    const employeeIds = await resolveReportScope(req);
    const data = await reportsService.getAttendanceSummaryReport(employeeIds, from, to);
    successResponse(res, 'Attendance summary report fetched', data);
  } catch (err) {
    next(err);
  }
};

// Payroll Summary — per-employee (or per-department) gross/deductions/net/overtime for a payroll month.
const payrollSummary = async (req, res, next) => {
  try {
    const month = parseInt(req.query.month, 10);
    const year = parseInt(req.query.year, 10);
    if (!month || !year) throw new BadRequestError('month and year are required');
    const groupBy = req.query.groupBy === 'department' ? 'department' : 'employee';

    const employeeIds = await resolveReportScope(req);
    const data = await reportsService.getPayrollSummaryReport(employeeIds, month, year, groupBy);
    successResponse(res, 'Payroll summary report fetched', data);
  } catch (err) {
    next(err);
  }
};

// Leave Summary — per-employee (or per-department) leave balance total/used/remaining per leave type for a year.
const leaveSummary = async (req, res, next) => {
  try {
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    const groupBy = req.query.groupBy === 'department' ? 'department' : 'employee';

    const employeeIds = await resolveReportScope(req);
    const data = await reportsService.getLeaveSummaryReport(employeeIds, year, req.user.company_id, groupBy);
    successResponse(res, 'Leave summary report fetched', data);
  } catch (err) {
    next(err);
  }
};

module.exports = {
  teamPerformance,
  attendanceSummary,
  payrollSummary,
  leaveSummary,
};
