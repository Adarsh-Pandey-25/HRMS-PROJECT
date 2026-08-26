const { supabaseAdmin } = require('../config/supabase');
const { BadRequestError } = require('../utils/errors');
const attendanceService = require('./attendance.service');
const leaveService = require('./leave.service');

const EMPLOYEE_SELECT = 'id, employee_code, first_name, last_name, department, designation';

const fetchEmployeesById = async (employeeIds) => {
  if (!employeeIds.length) return {};
  const { data, error } = await supabaseAdmin
    .from('employees')
    .select(EMPLOYEE_SELECT)
    .in('id', employeeIds);
  if (error) throw new BadRequestError(error.message);
  return Object.fromEntries((data || []).map((e) => [e.id, e]));
};

/** Per-employee attendance aggregation (present/absent/late/half-day/leave-days, hours) over a date range. */
const getAttendanceSummaryReport = async (employeeIds, from, to) => {
  if (!employeeIds.length) return [];
  const employeeById = await fetchEmployeesById(employeeIds);

  return Promise.all(employeeIds.map(async (employeeId) => ({
    employee: employeeById[employeeId] || { id: employeeId },
    summary: await attendanceService.getRangeSummary(employeeId, from, to),
  })));
};

/** Per-employee payroll rollup for a month/year, read straight from the `payroll` table; optionally rolled up by department. */
const getPayrollSummaryReport = async (employeeIds, month, year, groupBy = 'employee') => {
  if (!employeeIds.length) return [];

  const { data, error } = await supabaseAdmin
    .from('payroll')
    .select(`
      employee_id, basic_salary, hra, special_allowance, transport_allowance, medical_allowance,
      bonus, overtime_pay, gross_salary, pf_deduction, esi_deduction, tds, professional_tax,
      leave_deduction, other_deductions, lop_deduction, unpaid_leave_days, total_deductions, net_salary,
      payslip_status, payment_status,
      employee:employee_id(${EMPLOYEE_SELECT})
    `)
    .eq('month', month)
    .eq('year', year)
    .in('employee_id', employeeIds);

  if (error) throw new BadRequestError(error.message);
  const rows = data || [];

  if (groupBy !== 'department') return rows;

  const byDept = new Map();
  for (const r of rows) {
    const dept = r.employee?.department || 'Unassigned';
    if (!byDept.has(dept)) {
      byDept.set(dept, {
        department: dept,
        employeeCount: 0,
        grossSalary: 0,
        totalDeductions: 0,
        netSalary: 0,
        overtimePay: 0,
        pfDeduction: 0,
        esiDeduction: 0,
        tds: 0,
        professionalTax: 0,
      });
    }
    const agg = byDept.get(dept);
    agg.employeeCount += 1;
    agg.grossSalary += Number(r.gross_salary || 0);
    agg.totalDeductions += Number(r.total_deductions || 0);
    agg.netSalary += Number(r.net_salary || 0);
    agg.overtimePay += Number(r.overtime_pay || 0);
    agg.pfDeduction += Number(r.pf_deduction || 0);
    agg.esiDeduction += Number(r.esi_deduction || 0);
    agg.tds += Number(r.tds || 0);
    agg.professionalTax += Number(r.professional_tax || 0);
  }
  return Array.from(byDept.values());
};

/** Per-employee leave balance (total/used/remaining per leave type) for a year; optionally rolled up by department. */
const getLeaveSummaryReport = async (employeeIds, year, companyId, groupBy = 'employee') => {
  if (!employeeIds.length) return [];
  const employeeById = await fetchEmployeesById(employeeIds);

  const results = await Promise.all(employeeIds.map(async (employeeId) => ({
    employee: employeeById[employeeId] || { id: employeeId },
    balances: await leaveService.getLeaveBalance(employeeId, year, companyId),
  })));

  if (groupBy !== 'department') return results;

  const byDept = new Map();
  for (const r of results) {
    const dept = r.employee?.department || 'Unassigned';
    if (!byDept.has(dept)) byDept.set(dept, { department: dept, employeeCount: 0, byType: new Map() });
    const agg = byDept.get(dept);
    agg.employeeCount += 1;
    for (const b of r.balances || []) {
      if (!agg.byType.has(b.leave_type)) {
        agg.byType.set(b.leave_type, {
          leaveType: b.leave_type, name: b.name, totalAllocated: 0, used: 0, available: 0,
        });
      }
      const t = agg.byType.get(b.leave_type);
      t.totalAllocated += Number(b.total_allocated || 0);
      t.used += Number(b.used || 0);
      t.available += Number(b.available || 0);
    }
  }
  return Array.from(byDept.values()).map((d) => ({ ...d, byType: Array.from(d.byType.values()) }));
};

module.exports = {
  getAttendanceSummaryReport,
  getPayrollSummaryReport,
  getLeaveSummaryReport,
};
