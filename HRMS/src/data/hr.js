import { employees } from './employees';

const TODAY = '2026-07-08';
const MONTH = '2026-07';

// ---------------------------------------------------------------------------
//  Attendance
// ---------------------------------------------------------------------------
function pseudo(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = seed.charCodeAt(i) + ((h << 5) - h);
  return Math.abs(h);
}

// Per-day attendance for the demo user for the current month (days 1..8).
export const myAttendance = Array.from({ length: 8 }, (_, i) => {
  const day = i + 1;
  const date = `${MONTH}-${String(day).padStart(2, '0')}`;
  const dow = new Date(date).getDay();
  const weekend = dow === 0 || dow === 6;
  const r = pseudo(date);
  let status = 'present';
  let checkIn = '09:0' + (r % 6);
  let checkOut = '18:' + (10 + (r % 40));
  if (weekend) {
    status = 'weekend';
    checkIn = checkOut = null;
  } else if (r % 11 === 0) {
    status = 'wfh';
  } else if (r % 7 === 0) {
    status = 'late';
    checkIn = '10:' + (10 + (r % 40));
  }
  const workHours = checkIn ? +(8 + (r % 20) / 20).toFixed(2) : 0;
  return {
    id: `ATT-${date}`,
    employeeId: 'EMP-0001',
    date,
    checkIn,
    checkOut,
    workHours,
    overtime: workHours > 9 ? +(workHours - 9).toFixed(2) : 0,
    status,
    source: ['biometric', 'web', 'mobile'][r % 3],
  };
});

export const todayStatus = {
  date: TODAY,
  checkIn: '09:02',
  checkOut: null,
  status: 'present',
  workHours: 0,
};

export const myAttendanceSummary = {
  present: 18,
  absent: 1,
  late: 2,
  wfh: 4,
  avgHours: 8.6,
  overtime: 3.2,
};

// Team attendance snapshot for "today".
export const teamAttendanceToday = employees
  .filter((e) => e.status === 'active' || e.status === 'probation')
  .map((e) => {
    const r = pseudo(e.id + TODAY);
    let status = 'present';
    if (r % 13 === 0) status = 'absent';
    else if (r % 9 === 0) status = 'wfh';
    else if (r % 7 === 0) status = 'late';
    else if (e.status === 'on-leave') status = 'on-leave';
    const checkIn = status === 'absent' || status === 'on-leave' ? null : status === 'late' ? '10:' + (15 + (r % 30)) : '09:' + String(r % 30).padStart(2, '0');
    const checkOut = checkIn ? '18:' + String(10 + (r % 40)).padStart(2, '0') : null;
    const workHours = checkIn ? +(8 + (r % 20) / 20).toFixed(2) : 0;
    return { id: `ATT-${e.id}-${TODAY}`, employeeId: e.id, date: TODAY, checkIn, checkOut, workHours, status };
  });

export const attendanceKpis = (() => {
  const present = teamAttendanceToday.filter((a) => a.status === 'present').length;
  const wfh = teamAttendanceToday.filter((a) => a.status === 'wfh').length;
  const late = teamAttendanceToday.filter((a) => a.status === 'late').length;
  const absent = teamAttendanceToday.filter((a) => a.status === 'absent').length;
  return { present, wfh, late, absent, total: teamAttendanceToday.length };
})();

// Late-arrival trend (last 7 days) for admin chart.
export const lateArrivalTrend = ['Jul 02', 'Jul 03', 'Jul 04', 'Jul 05', 'Jul 06', 'Jul 07', 'Jul 08'].map((d, i) => ({
  day: d,
  late: [4, 6, 3, 5, 2, 7, 3][i],
  present: [22, 20, 24, 21, 25, 19, 23][i],
}));

// ---------------------------------------------------------------------------
//  Leave
// ---------------------------------------------------------------------------
export const leaveBalance = {
  employeeId: 'EMP-0001',
  year: 2026,
  balances: {
    annual: { total: 18, used: 5, remaining: 13 },
    sick: { total: 12, used: 2, remaining: 10 },
    casual: { total: 6, used: 1, remaining: 5 },
    compOff: { total: 2, used: 0, remaining: 2 },
  },
};

export const leaveRequests = [
  { id: 'LV-014', employeeId: 'EMP-0002', type: 'annual', from: '2026-07-15', to: '2026-07-18', days: 4, reason: 'Family vacation to Kerala', status: 'pending', approverId: 'EMP-0003', appliedOn: '2026-07-06', comments: '' },
  { id: 'LV-013', employeeId: 'EMP-0023', type: 'sick', from: '2026-07-09', to: '2026-07-10', days: 2, reason: 'Fever and rest advised', status: 'pending', approverId: 'EMP-0003', appliedOn: '2026-07-07', comments: '' },
  { id: 'LV-012', employeeId: 'EMP-0022', type: 'annual', from: '2026-07-01', to: '2026-07-12', days: 12, reason: 'Sabbatical travel', status: 'approved', approverId: 'EMP-0003', appliedOn: '2026-06-20', comments: 'Approved — coverage arranged.' },
  { id: 'LV-011', employeeId: 'EMP-0011', type: 'casual', from: '2026-07-11', to: '2026-07-11', days: 1, reason: 'Personal errand', status: 'pending', approverId: 'EMP-0010', appliedOn: '2026-07-08', comments: '' },
  { id: 'LV-010', employeeId: 'EMP-0007', type: 'annual', from: '2026-07-21', to: '2026-07-25', days: 5, reason: 'Wedding in the family', status: 'approved', approverId: 'EMP-0006', appliedOn: '2026-06-28', comments: 'Have a great time!' },
  { id: 'LV-009', employeeId: 'EMP-0001', type: 'annual', from: '2026-06-02', to: '2026-06-04', days: 3, reason: 'Long weekend break', status: 'approved', approverId: 'EMP-0001', appliedOn: '2026-05-20', comments: '' },
  { id: 'LV-008', employeeId: 'EMP-0001', type: 'sick', from: '2026-05-14', to: '2026-05-15', days: 2, reason: 'Migraine', status: 'approved', approverId: 'EMP-0001', appliedOn: '2026-05-14', comments: '' },
  { id: 'LV-007', employeeId: 'EMP-0018', type: 'casual', from: '2026-06-30', to: '2026-06-30', days: 1, reason: 'Bank work', status: 'rejected', approverId: 'EMP-0017', appliedOn: '2026-06-25', comments: 'Peak support week — please reschedule.' },
];

export const holidays = [
  { name: 'Independence Day', date: '2026-08-15', type: 'national' },
  { name: 'Ganesh Chaturthi', date: '2026-09-14', type: 'restricted' },
  { name: 'Gandhi Jayanti', date: '2026-10-02', type: 'national' },
  { name: 'Dussehra', date: '2026-10-20', type: 'national' },
  { name: 'Diwali', date: '2026-11-08', type: 'national' },
  { name: 'Christmas', date: '2026-12-25', type: 'national' },
];

export const leavePolicies = [
  { type: 'Annual Leave', total: 18, carryForward: 6, encashment: true },
  { type: 'Sick Leave', total: 12, carryForward: 0, encashment: false },
  { type: 'Casual Leave', total: 6, carryForward: 0, encashment: false },
  { type: 'Comp-off', total: 0, carryForward: 2, encashment: false },
  { type: 'Maternity Leave', total: 182, carryForward: 0, encashment: false },
  { type: 'Paternity Leave', total: 15, carryForward: 0, encashment: false },
];

// ---------------------------------------------------------------------------
//  Payroll
// ---------------------------------------------------------------------------
export const payrollRuns = [
  { month: '2026-07', status: 'draft', gross: 3120000, deductions: 486000, net: 2634000, employerPf: 268000, employees: 26 },
  { month: '2026-06', status: 'paid', gross: 3080000, deductions: 478000, net: 2602000, employerPf: 264000, employees: 26, paidOn: '2026-06-30' },
  { month: '2026-05', status: 'paid', gross: 3010000, deductions: 470000, net: 2540000, employerPf: 258000, employees: 25, paidOn: '2026-05-31' },
];

export const payrollCostTrend = [
  { month: 'Aug', cost: 2740000 }, { month: 'Sep', cost: 2810000 },
  { month: 'Oct', cost: 2790000 }, { month: 'Nov', cost: 2880000 },
  { month: 'Dec', cost: 2950000 }, { month: 'Jan', cost: 2900000 },
  { month: 'Feb', cost: 2930000 }, { month: 'Mar', cost: 2990000 },
  { month: 'Apr', cost: 2970000 }, { month: 'May', cost: 3010000 },
  { month: 'Jun', cost: 3080000 }, { month: 'Jul', cost: 3120000 },
];

// Salary sheet for the current run (subset of employees).
export const payrollSheet = employees
  .filter((e) => e.status !== 'resigned' && e.status !== 'terminated')
  .map((e) => {
    const s = e.salary;
    const gross = s.basic + s.hra + s.da + s.special;
    const lopDays = e.status === 'probation' ? 1 : 0;
    const tds = Math.round(gross * 0.08);
    const deductions = s.pf + s.esic + 200 + tds;
    return {
      id: `PAY-2026-07-${e.id.split('-')[1]}`,
      employeeId: e.id,
      month: '2026-07',
      daysInMonth: 31,
      daysWorked: 31 - lopDays,
      lopDays,
      earnings: { basic: s.basic, hra: s.hra, da: s.da, specialAllowance: s.special, incentive: 0, gross },
      deductions: { pf: s.pf, esic: s.esic, pt: 200, tds, advance: 0, total: deductions },
      netPay: gross - deductions,
      status: 'draft',
      isNewJoinee: e.status === 'probation',
    };
  });

// Payslip history for the demo employee.
export const myPayslips = ['2026-06', '2026-05', '2026-04', '2026-03', '2026-02', '2026-01'].map((month) => {
  const e = employees[0];
  const s = e.salary;
  const gross = s.basic + s.hra + s.da + s.special;
  const tds = Math.round(gross * 0.08);
  const deductions = s.pf + s.esic + 200 + tds;
  return {
    id: `PAY-${month}-0001`,
    employeeId: 'EMP-0001',
    month,
    earnings: { basic: s.basic, hra: s.hra, da: s.da, specialAllowance: s.special, incentive: month === '2026-03' ? 25000 : 0, gross: gross + (month === '2026-03' ? 25000 : 0) },
    deductions: { pf: s.pf, esic: s.esic, pt: 200, tds, advance: 0, total: deductions },
    netPay: gross - deductions + (month === '2026-03' ? 25000 : 0),
    status: 'paid',
    paidOn: `${month}-30`,
  };
});
