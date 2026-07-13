const moment = require('moment-timezone');
const { supabaseAdmin } = require('../config/supabase');
const { BadRequestError } = require('../utils/errors');
const { nowIST } = require('../utils/helpers');
const { getTeamEmployeeIds } = require('./attendance.service');
const leaveService = require('./leave.service');
const { TIMEZONE } = require('../utils/constants');

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const priorityLabel = (priority) => {
  const p = String(priority || 'medium').toLowerCase();
  if (p === 'urgent') return 'Urgent';
  if (p === 'high' || p === 'important') return 'Important';
  return 'Normal';
};

const relativeTime = (date) => {
  const m = moment(date);
  const days = nowIST().startOf('day').diff(m.startOf('day'), 'days');
  if (days <= 0) return 'Today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
};

const initials = (first, last) =>
  `${(first || '')[0] || ''}${(last || '')[0] || ''}`.toUpperCase() || '?';

const getActiveEmployees = async () => {
  const { data, error } = await supabaseAdmin
    .from('employees')
    .select('id, first_name, last_name, email, department, designation, role, date_of_joining, date_of_birth, created_at')
    .eq('is_active', true)
    .order('first_name');

  if (error) throw new BadRequestError(error.message);
  return data || [];
};

const getHeadcountTrend = (employees, months = 12) => {
  const now = nowIST();
  const trend = [];

  for (let i = months - 1; i >= 0; i -= 1) {
    const monthEnd = now.clone().subtract(i, 'months').endOf('month');
    const count = employees.filter((e) => {
      const joined = e.date_of_joining || e.created_at;
      if (!joined) return false;
      return moment(joined).isSameOrBefore(monthEnd, 'day');
    }).length;

    trend.push({
      month: MONTH_LABELS[monthEnd.month()],
      year: monthEnd.year(),
      count,
    });
  }

  return trend;
};

const getDepartmentBreakdown = (employees) => {
  const counts = {};
  for (const e of employees) {
    const dept = (e.department || 'Unassigned').trim() || 'Unassigned';
    counts[dept] = (counts[dept] || 0) + 1;
  }

  const palette = ['#4f46e5', '#06b6d4', '#f59e0b', '#ef4444', '#10b981', '#3b82f6', '#ec4899', '#8b5cf6'];

  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([department, count], idx) => ({
      department,
      count,
      color: palette[idx % palette.length],
    }));
};

const getEmployeeTrendPercent = (employees) => {
  const now = nowIST();
  const lastMonthEnd = now.clone().subtract(1, 'month').endOf('month');

  const countAtLastMonth = employees.filter((e) => {
    const joined = e.date_of_joining || e.created_at;
    return joined && moment(joined).isSameOrBefore(lastMonthEnd, 'day');
  }).length;

  const countNow = employees.length;
  if (!countAtLastMonth) return countNow > 0 ? 100 : 0;
  return Math.round(((countNow - countAtLastMonth) / countAtLastMonth) * 100);
};

const getTodayAttendanceSummary = async (employeeIds) => {
  const start = nowIST().startOf('day').toISOString();
  const end = nowIST().endOf('day').toISOString();

  const emptyId = '00000000-0000-0000-0000-000000000000';
  const { data: attendance, error } = await supabaseAdmin
    .from('attendance')
    .select('employee_id, status')
    .in('employee_id', employeeIds.length ? employeeIds : [emptyId])
    .gte('check_in_time', start)
    .lte('check_in_time', end);

  if (error) throw new BadRequestError(error.message);

  const todayStr = nowIST().format('YYYY-MM-DD');
  const { data: leaves } = await supabaseAdmin
    .from('leaves')
    .select('employee_id, leave_type')
    .eq('status', 'approved')
    .lte('from_date', todayStr)
    .gte('to_date', todayStr);

  const wfhIds = new Set((leaves || []).filter((l) => l.leave_type === 'WFH').map((l) => l.employee_id));
  const onLeaveIds = new Set((leaves || []).filter((l) => l.leave_type !== 'WFH').map((l) => l.employee_id));

  const presentIds = new Set();
  let late = 0;

  for (const row of attendance || []) {
    if (row.status === 'late') late += 1;
    if (['present', 'late', 'early_departure', 'half_day'].includes(row.status)) {
      presentIds.add(row.employee_id);
    }
  }

  const wfh = wfhIds.size;
  const present = [...presentIds].filter((id) => !wfhIds.has(id)).length;
  const onLeave = onLeaveIds.size;
  const teamSize = employeeIds.length;
  const absent = Math.max(0, teamSize - present - wfh - onLeave);

  return { present, wfh, late, absent, onLeave, teamSize };
};

const getOnLeaveTodayCount = async () => {
  const todayStr = nowIST().format('YYYY-MM-DD');
  const { count, error } = await supabaseAdmin
    .from('leaves')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'approved')
    .lte('from_date', todayStr)
    .gte('to_date', todayStr);

  if (error) throw new BadRequestError(error.message);
  return count || 0;
};

const getPayrollSummary = async (month, year) => {
  const { data, error } = await supabaseAdmin
    .from('payroll')
    .select('gross_salary')
    .eq('month', month)
    .eq('year', year);

  if (error) throw new BadRequestError(error.message);

  const current = (data || []).reduce((s, r) => s + Number(r.gross_salary || 0), 0);

  const prev = moment({ year, month: month - 1 }).subtract(1, 'month');
  const { data: prevData } = await supabaseAdmin
    .from('payroll')
    .select('gross_salary')
    .eq('month', prev.month() + 1)
    .eq('year', prev.year());

  const previous = (prevData || []).reduce((s, r) => s + Number(r.gross_salary || 0), 0);
  const changePercent = previous
    ? Math.round(((current - previous) / previous) * 1000) / 10
    : 0;

  return { current, previous, changePercent };
};

const getNewHiresThisMonth = (employees) => {
  const start = nowIST().startOf('month');
  const end = nowIST().endOf('month');

  return employees
    .filter((e) => {
      const joined = e.date_of_joining || e.created_at;
      return joined && moment(joined).isBetween(start, end, 'day', '[]');
    })
    .map((e) => ({
      id: e.id,
      firstName: e.first_name,
      lastName: e.last_name,
      initials: initials(e.first_name, e.last_name),
      designation: e.designation || 'Employee',
      department: e.department || '',
      joinedAt: e.date_of_joining || e.created_at,
      label: [e.designation, e.department].filter(Boolean).join(' · '),
    }))
    .sort((a, b) => new Date(b.joinedAt) - new Date(a.joinedAt));
};

const getPendingApprovals = async () => {
  const [{ count: leaves }, { count: expenses }] = await Promise.all([
    supabaseAdmin.from('leaves').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    supabaseAdmin.from('reimbursements').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
  ]);

  return {
    leaves: leaves || 0,
    expenses: expenses || 0,
    assets: 0,
    total: (leaves || 0) + (expenses || 0),
  };
};

const getRecentAnnouncements = async (limit = 3) => {
  const { data, error } = await supabaseAdmin
    .from('announcements')
    .select('id, title, priority, published_at, created_at')
    .eq('is_active', true)
    .order('published_at', { ascending: false })
    .limit(limit);

  if (error) throw new BadRequestError(error.message);

  return (data || []).map((a) => ({
    id: a.id,
    title: a.title,
    relativeTime: relativeTime(a.published_at || a.created_at),
    priority: priorityLabel(a.priority),
  }));
};

const getUpcomingEvents = (employees) => {
  const today = nowIST().startOf('day');
  const horizon = today.clone().add(30, 'days');
  const events = [];

  for (const e of employees) {
    if (e.date_of_birth) {
      const dob = moment(e.date_of_birth);
      let next = dob.clone().year(today.year());
      if (next.isBefore(today, 'day')) next = next.add(1, 'year');
      if (next.isBetween(today, horizon, 'day', '[]')) {
        events.push({
          id: `bday-${e.id}`,
          type: 'birthday',
          title: `${e.first_name} ${e.last_name}`,
          subtitle: 'Birthday',
          date: next.format('DD MMM'),
          sortDate: next.toISOString(),
        });
      }
    }

    if (e.date_of_joining) {
      const joined = moment(e.date_of_joining);
      const years = today.year() - joined.year();
      if (years > 0) {
        let anniversary = joined.clone().year(today.year());
        if (anniversary.isBefore(today, 'day')) anniversary = anniversary.add(1, 'year');
        if (anniversary.isBetween(today, horizon, 'day', '[]')) {
          events.push({
            id: `anniv-${e.id}`,
            type: 'anniversary',
            title: `${e.first_name} ${e.last_name}`,
            subtitle: `${years} yrs anniversary`,
            date: anniversary.format('DD MMM'),
            sortDate: anniversary.toISOString(),
          });
        }
      }
    }
  }

  return events.sort((a, b) => new Date(a.sortDate) - new Date(b.sortDate)).slice(0, 8);
};

const getTeamMood = (teamSize = 0) => ({
  totalCheckIns: teamSize || 26,
  placeholder: true,
  items: [
    { mood: 'Great', emoji: '😁', count: 3, color: '#22c55e' },
    { mood: 'Good', emoji: '🙂', count: 4, color: '#14b8a6' },
    { mood: 'Okay', emoji: '😐', count: 6, color: '#3b82f6' },
    { mood: 'Low', emoji: '🙁', count: 5, color: '#f97316' },
    { mood: 'Stressed', emoji: '😫', count: 8, color: '#ef4444' },
  ],
});

const getRecentActivity = async (employees) => {
  const activities = [];
  const empMap = new Map(employees.map((e) => [e.id, e]));

  const [{ data: recentLeaves }, { data: recentReimb }, { data: recentEmployees }] = await Promise.all([
    supabaseAdmin
      .from('leaves')
      .select('id, employee_id, status, updated_at, created_at')
      .eq('status', 'approved')
      .order('updated_at', { ascending: false })
      .limit(5),
    supabaseAdmin
      .from('reimbursements')
      .select('id, employee_id, amount, created_at')
      .order('created_at', { ascending: false })
      .limit(5),
    supabaseAdmin
      .from('employees')
      .select('id, first_name, last_name, designation, date_of_joining, created_at')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(5),
  ]);

  for (const e of recentEmployees || []) {
    activities.push({
      id: `join-${e.id}`,
      type: 'join',
      dotColor: '#22c55e',
      initials: initials(e.first_name, e.last_name),
      message: `${e.first_name} ${e.last_name} joined as ${e.designation || 'Employee'}`,
      relativeTime: relativeTime(e.date_of_joining || e.created_at),
      sortAt: e.date_of_joining || e.created_at,
    });
  }

  for (const l of recentLeaves || []) {
    const emp = empMap.get(l.employee_id);
    if (!emp) continue;
    activities.push({
      id: `leave-${l.id}`,
      type: 'leave',
      dotColor: '#3b82f6',
      initials: initials(emp.first_name, emp.last_name),
      message: `${emp.first_name} ${emp.last_name} leave request approved`,
      relativeTime: relativeTime(l.updated_at || l.created_at),
      sortAt: l.updated_at || l.created_at,
    });
  }

  for (const r of recentReimb || []) {
    const emp = empMap.get(r.employee_id);
    if (!emp) continue;
    activities.push({
      id: `reimb-${r.id}`,
      type: 'expense',
      dotColor: '#f97316',
      initials: initials(emp.first_name, emp.last_name),
      message: `${emp.first_name} ${emp.last_name} submitted a ₹${Number(r.amount || 0).toLocaleString('en-IN')} expense claim`,
      relativeTime: relativeTime(r.created_at),
      sortAt: r.created_at,
    });
  }

  return activities
    .sort((a, b) => new Date(b.sortAt) - new Date(a.sortAt))
    .slice(0, 8);
};

const globalSearch = async (query, limit = 8, { role } = {}) => {
  const q = String(query || '').trim();
  if (!q || q.length < 2) return { employees: [], leaves: [], announcements: [] };

  const pattern = `%${q}%`;

  const { data: announcements } = await supabaseAdmin
    .from('announcements')
    .select('id, title')
    .eq('is_active', true)
    .ilike('title', pattern)
    .limit(limit);

  const announcementResults = (announcements || []).map((a) => ({
    id: a.id,
    label: a.title,
    type: 'announcement',
  }));

  if (role === 'employee') {
    return { employees: [], announcements: announcementResults, leaves: [] };
  }

  const { data: employees } = await supabaseAdmin
    .from('employees')
    .select('id, first_name, last_name, email, department, employee_code')
    .eq('is_active', true)
    .or(`first_name.ilike.${pattern},last_name.ilike.${pattern},email.ilike.${pattern},employee_code.ilike.${pattern}`)
    .limit(limit);

  return {
    employees: (employees || []).map((e) => ({
      id: e.id,
      label: `${e.first_name} ${e.last_name}`,
      sublabel: e.department || e.email,
      type: 'employee',
    })),
    announcements: announcementResults,
    leaves: [],
  };
};

const leaveTypeLabel = (type) => {
  const map = {
    CL: 'Casual',
    SL: 'Sick',
    EL: 'Annual',
    WFH: 'WFH',
    COMP_OFF: 'Comp Off',
    MATERNITY: 'Maternity',
    PATERNITY: 'Paternity',
    UNPAID: 'Unpaid',
  };
  return map[type] || type;
};

const reimbTypeLabel = (type) => {
  const map = {
    travel: 'Travel',
    food: 'Food',
    medical: 'Medical',
    internet_phone: 'Internet/Phone',
    office_supplies: 'Office Supplies',
    client_entertainment: 'Client Entertainment',
    other: 'Other',
  };
  return map[type] || type;
};

const getNewHiresTrendPercent = (employees) => {
  const now = nowIST();
  const thisMonthStart = now.clone().startOf('month');
  const lastMonthStart = now.clone().subtract(1, 'month').startOf('month');
  const lastMonthEnd = now.clone().subtract(1, 'month').endOf('month');

  const thisMonth = employees.filter((e) => {
    const joined = e.date_of_joining || e.created_at;
    return joined && moment(joined).isBetween(thisMonthStart, now, 'day', '[]');
  }).length;

  const lastMonth = employees.filter((e) => {
    const joined = e.date_of_joining || e.created_at;
    return joined && moment(joined).isBetween(lastMonthStart, lastMonthEnd, 'day', '[]');
  }).length;

  if (!lastMonth) return thisMonth > 0 ? 100 : 0;
  return Math.round(((thisMonth - lastMonth) / lastMonth) * 100);
};

const getPendingLeaveList = async (limit = 5) => {
  const { data, error } = await supabaseAdmin
    .from('leaves')
    .select('id, leave_type, from_date, total_days, employee:employee_id(id, first_name, last_name)')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw new BadRequestError(error.message);

  return (data || []).map((row) => {
    const emp = row.employee || {};
    return {
      id: row.id,
      employeeId: emp.id,
      firstName: emp.first_name,
      lastName: emp.last_name,
      initials: initials(emp.first_name, emp.last_name),
      leaveType: leaveTypeLabel(row.leave_type),
      totalDays: Number(row.total_days || 0),
      fromDate: moment(row.from_date).format('DD MMM'),
      status: 'Pending',
    };
  });
};

const getPendingExpenseList = async (limit = 5) => {
  const { data, error } = await supabaseAdmin
    .from('reimbursements')
    .select('id, reimbursement_type, description, employee:employee_id(id, first_name, last_name)')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw new BadRequestError(error.message);

  return (data || []).map((row) => {
    const emp = row.employee || {};
    return {
      id: row.id,
      employeeId: emp.id,
      firstName: emp.first_name,
      lastName: emp.last_name,
      initials: initials(emp.first_name, emp.last_name),
      category: reimbTypeLabel(row.reimbursement_type),
      description: row.description || '',
      status: 'Pending',
    };
  });
};

const getRecentHiresLastMonth = (employees, limit = 5) => {
  const since = nowIST().subtract(30, 'days');

  return employees
    .filter((e) => {
      const joined = e.date_of_joining || e.created_at;
      return joined && moment(joined).isSameOrAfter(since, 'day');
    })
    .map((e) => ({
      id: e.id,
      firstName: e.first_name,
      lastName: e.last_name,
      initials: initials(e.first_name, e.last_name),
      designation: e.designation || 'Employee',
      joinedAt: e.date_of_joining || e.created_at,
      label: [e.designation, moment(e.date_of_joining || e.created_at).format('DD MMM')].filter(Boolean).join(' · '),
    }))
    .sort((a, b) => new Date(b.joinedAt) - new Date(a.joinedAt))
    .slice(0, limit);
};

const getUpcomingInterviewsPlaceholder = () => ({
  placeholder: true,
  items: [
    {
      id: 'int-1',
      candidateName: 'Karan Singh',
      role: 'Senior React Developer',
      interviewer: 'Diya Nair',
      scheduledAt: nowIST().format('DD MMM') + ' 11:00',
    },
    {
      id: 'int-2',
      candidateName: 'Sneha Patil',
      role: 'Product Designer',
      interviewer: 'Rohan Gupta',
      scheduledAt: nowIST().format('DD MMM') + ' 15:30',
    },
    {
      id: 'int-3',
      candidateName: 'Rohit Verma',
      role: 'Senior React Developer',
      interviewer: 'Kabir Rao',
      scheduledAt: nowIST().add(1, 'day').format('DD MMM') + ' 10:00',
    },
  ],
});

const getAdminDashboard = async () => {
  const employees = await getActiveEmployees();
  const teamEmployees = employees.filter((e) => e.role === 'employee' || e.role === 'manager');
  const teamIds = teamEmployees.map((e) => e.id);

  const now = nowIST();
  const month = now.month() + 1;
  const year = now.year();

  const [
    attendanceToday,
    onLeaveToday,
    payroll,
    pendingApprovals,
    recentAnnouncements,
    recentActivity,
  ] = await Promise.all([
    getTodayAttendanceSummary(teamIds),
    getOnLeaveTodayCount(),
    getPayrollSummary(month, year),
    getPendingApprovals(),
    getRecentAnnouncements(3),
    getRecentActivity(employees),
  ]);

  const newHires = getNewHiresThisMonth(employees);

  return {
    greeting: {
      date: now.format('dddd, MMMM D, YYYY'),
    },
    kpis: {
      totalEmployees: employees.length,
      employeeTrendPercent: getEmployeeTrendPercent(employees),
      presentToday: attendanceToday.present,
      teamSize: attendanceToday.teamSize,
      onLeaveToday,
      openPositions: 0,
      openPositionsPlaceholder: true,
    },
    headcountTrend: getHeadcountTrend(employees, 12),
    byDepartment: getDepartmentBreakdown(employees),
    payrollCost: {
      current: payroll.current,
      previous: payroll.previous,
      changePercent: payroll.changePercent,
      currency: 'INR',
    },
    newHires: {
      count: newHires.length,
      items: newHires,
    },
    recentAnnouncements,
    attendanceToday,
    pendingApprovals,
    upcoming: getUpcomingEvents(employees),
    teamMood: getTeamMood(attendanceToday.teamSize),
    recentActivity,
  };
};

const getHrDashboard = async () => {
  const employees = await getActiveEmployees();
  const teamEmployees = employees.filter((e) => e.role === 'employee' || e.role === 'manager');
  const teamIds = teamEmployees.map((e) => e.id);

  const now = nowIST();
  const newHiresThisMonth = getNewHiresThisMonth(employees);

  const [
    attendanceSummary,
    onLeaveToday,
    pendingLeaves,
    pendingExpenses,
    recentAnnouncements,
    pendingCounts,
  ] = await Promise.all([
    getTodayAttendanceSummary(teamIds),
    getOnLeaveTodayCount(),
    getPendingLeaveList(5),
    getPendingExpenseList(5),
    getRecentAnnouncements(3),
    getPendingApprovals(),
  ]);

  return {
    greeting: {
      date: now.format('dddd, MMMM D, YYYY'),
    },
    kpis: {
      totalEmployees: employees.length,
      employeeTrendPercent: getEmployeeTrendPercent(employees),
      newThisMonth: newHiresThisMonth.length,
      newHiresTrendPercent: getNewHiresTrendPercent(employees),
      onLeaveToday,
      openPositions: 0,
      openPositionsPlaceholder: true,
    },
    attendanceSummary: {
      ...attendanceSummary,
      subtitle: `${attendanceSummary.teamSize} team members · org-wide`,
    },
    upcomingInterviews: getUpcomingInterviewsPlaceholder(),
    pendingLeaveApprovals: {
      count: pendingCounts.leaves,
      items: pendingLeaves,
    },
    pendingExpenseClaims: {
      count: pendingCounts.expenses,
      items: pendingExpenses,
    },
    recentHires: {
      items: getRecentHiresLastMonth(employees, 5),
    },
    teamMood: getTeamMood(attendanceSummary.teamSize),
    recentAnnouncements,
  };
};

const LEAVE_BALANCE_LABELS = {
  EL: 'Annual',
  SL: 'Sick',
  CL: 'Casual',
  COMP_OFF: 'Comp-off',
};

const getEmployeeTodayStatus = async (employeeId) => {
  const start = nowIST().startOf('day').toISOString();
  const end = nowIST().endOf('day').toISOString();

  const { data, error } = await supabaseAdmin
    .from('attendance')
    .select('id, check_in_time, check_out_time, status')
    .eq('employee_id', employeeId)
    .gte('check_in_time', start)
    .lte('check_in_time', end)
    .order('check_in_time', { ascending: false })
    .limit(1);

  if (error) throw new BadRequestError(error.message);

  const record = data?.[0];
  if (!record) {
    return {
      status: 'not_checked_in',
      checkInTime: null,
      checkOutTime: null,
      label: 'Not checked in',
      checkInLabel: null,
      canCheckIn: true,
      canCheckOut: false,
    };
  }

  const checkInLabel = moment(record.check_in_time).tz(TIMEZONE).format('HH:mm');

  if (!record.check_out_time) {
    return {
      status: 'checked_in',
      checkInTime: record.check_in_time,
      checkOutTime: null,
      label: 'Checked in',
      checkInLabel,
      canCheckIn: false,
      canCheckOut: true,
    };
  }

  return {
    status: 'checked_out',
    checkInTime: record.check_in_time,
    checkOutTime: record.check_out_time,
    label: 'Day complete',
    checkInLabel,
    canCheckIn: false,
    canCheckOut: false,
  };
};

const getLast7DaysAttendance = async (employeeId) => {
  const today = nowIST().startOf('day');
  const days = [];
  for (let i = 6; i >= 0; i -= 1) {
    days.push(today.clone().subtract(i, 'days'));
  }

  const start = days[0].clone().startOf('day').toISOString();
  const end = days[6].clone().endOf('day').toISOString();

  const { data: records } = await supabaseAdmin
    .from('attendance')
    .select('check_in_time, status')
    .eq('employee_id', employeeId)
    .gte('check_in_time', start)
    .lte('check_in_time', end);

  const byDate = {};
  for (const row of records || []) {
    const key = moment(row.check_in_time).tz(TIMEZONE).format('YYYY-MM-DD');
    byDate[key] = row.status;
  }

  return days.map((day) => {
    const key = day.format('YYYY-MM-DD');
    const dow = day.day();
    const isWeekend = dow === 0 || dow === 6;
    let state = 'none';

    if (day.isAfter(today, 'day')) state = 'future';
    else if (isWeekend) state = 'weekend';
    else if (byDate[key]) state = byDate[key] === 'late' ? 'late' : 'present';
    else if (day.isBefore(today, 'day')) state = 'absent';

    return {
      date: key,
      dayLabel: day.format('ddd'),
      dateLabel: String(day.date()),
      state,
      isToday: day.isSame(today, 'day'),
    };
  });
};

const getAttendanceDaysThisMonth = async (employeeId) => {
  const month = nowIST().month() + 1;
  const year = nowIST().year();
  const start = nowIST().clone().startOf('month');
  const end = nowIST().clone().endOf('month');

  const { data, error } = await supabaseAdmin
    .from('attendance')
    .select('status')
    .eq('employee_id', employeeId)
    .gte('check_in_time', start.toISOString())
    .lte('check_in_time', end.toISOString());

  if (error) throw new BadRequestError(error.message);

  const presentStatuses = ['present', 'late', 'early_departure', 'half_day'];
  return (data || []).filter((r) => presentStatuses.includes(r.status)).length;
};

const getEmployeeLeaveBalances = async (employeeId) => {
  const year = nowIST().year();
  const balances = await leaveService.getLeaveBalance(employeeId, year);
  const displayTypes = ['EL', 'SL', 'CL', 'COMP_OFF'];

  return displayTypes
    .map((code) => {
      const row = balances.find((b) => b.leave_type === code);
      if (!row) return null;
      const total = Number(row.total_allocated || 0);
      const available = Number(row.available ?? (total - row.used - row.encashed));
      return {
        code,
        label: LEAVE_BALANCE_LABELS[code] || code,
        available,
        total,
        used: Number(row.used || 0),
        display: `${available}/${total}`,
      };
    })
    .filter(Boolean);
};

const getLatestPayslip = async (employeeId) => {
  const { data, error } = await supabaseAdmin
    .from('payroll')
    .select('id, month, year, net_salary, payslip_status, payment_status')
    .eq('employee_id', employeeId)
    .eq('payslip_status', 'PUBLISHED')
    .order('year', { ascending: false })
    .order('month', { ascending: false })
    .limit(1);

  if (error) throw new BadRequestError(error.message);

  const row = data?.[0];
  if (!row) return null;

  const period = moment.tz({ year: row.year, month: row.month - 1 }, TIMEZONE).format('MMMM YYYY');
  const paid = String(row.payment_status || '').toLowerCase() === 'paid';

  return {
    id: row.id,
    month: row.month,
    year: row.year,
    period,
    netPay: Number(row.net_salary || 0),
    status: paid ? 'Paid' : 'Published',
    subtitle: paid ? 'Net pay • Paid' : 'Net pay • Published',
  };
};

const getOpenExpenseClaims = async (employeeId, limit = 5) => {
  const [{ count }, { data, error }] = await Promise.all([
    supabaseAdmin
      .from('reimbursements')
      .select('id', { count: 'exact', head: true })
      .eq('employee_id', employeeId)
      .in('status', ['pending', 'approved']),
    supabaseAdmin
      .from('reimbursements')
      .select('id, reimbursement_type, description, amount, status')
      .eq('employee_id', employeeId)
      .in('status', ['pending', 'approved'])
      .order('created_at', { ascending: false })
      .limit(limit),
  ]);

  if (error) throw new BadRequestError(error.message);

  const categoryLabel = (type) => {
    if (type === 'food') return 'Meals';
    return reimbTypeLabel(type);
  };

  const items = (data || []).map((row) => ({
    id: row.id,
    title: row.description || 'Expense claim',
    category: categoryLabel(row.reimbursement_type),
    amount: Number(row.amount || 0),
    status: row.status === 'approved' ? 'Approved' : 'Pending',
  }));

  return { count: count || 0, items };
};

const getEmployeeDashboard = async (employeeId) => {
  const now = nowIST();
  const year = now.year();

  const [
    todayStatus,
    last7Days,
    attendanceThisMonth,
    leaveBalances,
    latestPayslip,
    openExpenses,
    recentAnnouncements,
    pendingExpenseResult,
  ] = await Promise.all([
    getEmployeeTodayStatus(employeeId),
    getLast7DaysAttendance(employeeId),
    getAttendanceDaysThisMonth(employeeId),
    getEmployeeLeaveBalances(employeeId),
    getLatestPayslip(employeeId),
    getOpenExpenseClaims(employeeId, 5),
    getRecentAnnouncements(3),
    supabaseAdmin
      .from('reimbursements')
      .select('id', { count: 'exact', head: true })
      .eq('employee_id', employeeId)
      .eq('status', 'pending'),
  ]);

  const leaveBalanceTotal = leaveBalances.reduce((sum, b) => sum + b.available, 0);

  return {
    greeting: { date: now.format('dddd, MMMM D, YYYY') },
    kpis: {
      attendanceThisMonth,
      leaveBalanceTotal,
      pendingExpenses: pendingExpenseResult.count || 0,
      openTickets: 0,
      openTicketsPlaceholder: true,
    },
    todayStatus,
    last7Days,
    leaveBalances: { year, items: leaveBalances },
    latestPayslip,
    openExpenseClaims: openExpenses,
    wellness: { placeholder: true },
    recentAnnouncements,
  };
};

const getTeamMoodForManager = (teamSize = 0) => {
  const moods = [
    { mood: 'Great', emoji: '😁', color: '#22c55e' },
    { mood: 'Good', emoji: '🙂', color: '#14b8a6' },
    { mood: 'Okay', emoji: '😐', color: '#3b82f6' },
    { mood: 'Low', emoji: '🙁', color: '#f97316' },
    { mood: 'Stressed', emoji: '😫', color: '#ef4444' },
  ];
  const base = [1, 1, 3, 1, 2];
  let counts = base.map(() => 0);

  if (teamSize > 0) {
    const sum = base.reduce((a, b) => a + b, 0);
    counts = base.map((c) => Math.max(0, Math.round((c / sum) * teamSize)));
    const diff = teamSize - counts.reduce((a, b) => a + b, 0);
    if (diff !== 0) counts[2] += diff;
  }

  return {
    totalCheckIns: teamSize,
    placeholder: true,
    items: moods.map((m, idx) => ({ ...m, count: counts[idx] })),
  };
};

const getOnLeaveTodayForTeam = async (employeeIds) => {
  if (!employeeIds.length) return 0;
  const todayStr = nowIST().format('YYYY-MM-DD');
  const { count, error } = await supabaseAdmin
    .from('leaves')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'approved')
    .neq('leave_type', 'WFH')
    .in('employee_id', employeeIds)
    .lte('from_date', todayStr)
    .gte('to_date', todayStr);

  if (error) throw new BadRequestError(error.message);
  return count || 0;
};

const getPendingLeaveListForTeam = async (teamIds, limit = 5) => {
  if (!teamIds.length) return { count: 0, items: [] };

  const [{ count }, { data, error }] = await Promise.all([
    supabaseAdmin
      .from('leaves')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
      .in('employee_id', teamIds),
    supabaseAdmin
      .from('leaves')
      .select('id, leave_type, from_date, total_days, employee:employee_id(id, first_name, last_name)')
      .eq('status', 'pending')
      .in('employee_id', teamIds)
      .order('created_at', { ascending: false })
      .limit(limit),
  ]);

  if (error) throw new BadRequestError(error.message);

  const items = (data || []).map((row) => {
    const emp = row.employee || {};
    return {
      id: row.id,
      firstName: emp.first_name,
      lastName: emp.last_name,
      initials: initials(emp.first_name, emp.last_name),
      leaveType: leaveTypeLabel(row.leave_type),
      totalDays: Number(row.total_days || 0),
      fromDate: moment(row.from_date).format('DD MMM'),
      status: 'Pending',
    };
  });

  return { count: count || 0, items };
};

const getPendingExpenseListForTeam = async (teamIds, limit = 5) => {
  if (!teamIds.length) return { count: 0, items: [] };

  const [{ count }, { data, error }] = await Promise.all([
    supabaseAdmin
      .from('reimbursements')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
      .in('employee_id', teamIds),
    supabaseAdmin
      .from('reimbursements')
      .select('id, reimbursement_type, description, employee:employee_id(id, first_name, last_name)')
      .eq('status', 'pending')
      .in('employee_id', teamIds)
      .order('created_at', { ascending: false })
      .limit(limit),
  ]);

  if (error) throw new BadRequestError(error.message);

  const items = (data || []).map((row) => {
    const emp = row.employee || {};
    const desc = row.description || '';
    return {
      id: row.id,
      firstName: emp.first_name,
      lastName: emp.last_name,
      initials: initials(emp.first_name, emp.last_name),
      category: reimbTypeLabel(row.reimbursement_type),
      description: desc,
      label: `${reimbTypeLabel(row.reimbursement_type)} · ${desc}`,
      status: 'Pending',
    };
  });

  return { count: count || 0, items };
};

const getTeamPerformancePlaceholder = (teamMembers) => ({
  placeholder: true,
  items: teamMembers.slice(0, 4).map((e, idx) => ({
    id: e.id,
    firstName: e.first_name,
    lastName: e.last_name,
    initials: initials(e.first_name, e.last_name),
    status: 'Pending',
    score: Math.round((3.9 - idx * 0.15) * 10) / 10,
    progress: Math.max(20, 75 - idx * 12),
  })),
});

const getManagerDashboard = async (managerId) => {
  const teamIds = await getTeamEmployeeIds(managerId);

  const { data: teamMembers, error: teamError } = await supabaseAdmin
    .from('employees')
    .select('id, first_name, last_name, department, designation')
    .eq('manager_id', managerId)
    .eq('is_active', true)
    .order('first_name');

  if (teamError) throw new BadRequestError(teamError.message);

  const team = teamMembers || [];
  const now = nowIST();

  const [
    teamAttendance,
    onLeaveToday,
    pendingLeaves,
    pendingExpenses,
    recentAnnouncements,
  ] = await Promise.all([
    getTodayAttendanceSummary(teamIds),
    getOnLeaveTodayForTeam(teamIds),
    getPendingLeaveListForTeam(teamIds, 5),
    getPendingExpenseListForTeam(teamIds, 5),
    getRecentAnnouncements(3),
  ]);

  const pendingTotal = pendingLeaves.count + pendingExpenses.count;

  return {
    greeting: {
      date: now.format('dddd, MMMM D, YYYY'),
    },
    kpis: {
      teamSize: team.length,
      presentToday: teamAttendance.present,
      onLeaveToday,
      pendingApprovals: pendingTotal,
    },
    teamAttendance: {
      present: teamAttendance.present,
      wfh: teamAttendance.wfh,
      late: teamAttendance.late,
      absent: teamAttendance.absent,
      teamSize: team.length,
    },
    pendingLeaveApprovals: pendingLeaves,
    pendingExpenseApprovals: pendingExpenses,
    teamPerformance: getTeamPerformancePlaceholder(team),
    myTeam: {
      count: team.length,
      items: team.map((e) => ({
        id: e.id,
        firstName: e.first_name,
        lastName: e.last_name,
        initials: initials(e.first_name, e.last_name),
        designation: e.designation || 'Employee',
        department: e.department || 'Unassigned',
      })),
    },
    teamMood: getTeamMoodForManager(team.length),
    recentAnnouncements,
  };
};

module.exports = {
  getAdminDashboard,
  getHrDashboard,
  getManagerDashboard,
  getEmployeeDashboard,
  globalSearch,
};
