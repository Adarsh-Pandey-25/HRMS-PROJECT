const { supabaseAdmin } = require('../config/supabase');
const attendanceService = require('../services/attendance.service');
const { successResponse } = require('../utils/helpers');
const { BadRequestError } = require('../utils/errors');

// Manager "team performance" = monthly attendance + leave + reimbursement summaries for team.
const teamPerformance = async (req, res, next) => {
  try {
    const month = parseInt(req.query.month, 10);
    const year = parseInt(req.query.year, 10);
    if (!month || !year) throw new BadRequestError('month and year are required');

    const teamIds = await attendanceService.getTeamEmployeeIds(req.user.id);
    const summaries = [];

    for (const employeeId of teamIds) {
      const { data: employee } = await supabaseAdmin
        .from('employees')
        .select('id, employee_code, first_name, last_name, department, designation')
        .eq('id', employeeId)
        .single();

      const attendance = await attendanceService.getMonthlySummary(employeeId, month, year);

      const { data: leaves } = await supabaseAdmin
        .from('leaves')
        .select('id,status,total_days')
        .eq('employee_id', employeeId)
        .gte('from_date', `${year}-${String(month).padStart(2, '0')}-01`)
        .lte('to_date', `${year}-${String(month).padStart(2, '0')}-31`);

      const { data: reimbursements } = await supabaseAdmin
        .from('reimbursements')
        .select('id,status,amount,expense_date')
        .eq('employee_id', employeeId)
        .gte('expense_date', `${year}-${String(month).padStart(2, '0')}-01`)
        .lte('expense_date', `${year}-${String(month).padStart(2, '0')}-31`);

      summaries.push({
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
      });
    }

    successResponse(res, 'Team performance report fetched', summaries);
  } catch (err) {
    next(err);
  }
};

module.exports = { teamPerformance };

