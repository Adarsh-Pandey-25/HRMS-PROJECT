import { toCamelCase } from './case';

/** Frontend leave type labels → backend codes */
export const LEAVE_TYPE_TO_API = {
  annual: 'EL',
  sick: 'SL',
  casual: 'CL',
  'comp-off': 'COMP_OFF',
  unpaid: 'UNPAID',
  maternity: 'MATERNITY',
  paternity: 'PATERNITY',
  wfh: 'WFH',
};

export const LEAVE_TYPE_FROM_API = Object.fromEntries(
  Object.entries(LEAVE_TYPE_TO_API).map(([k, v]) => [v, k])
);

export const LEAVE_BALANCE_KEYS = {
  EL: 'annual',
  SL: 'sick',
  CL: 'casual',
  COMP_OFF: 'compOff',
};

export const LEAVE_TYPE_LABELS = {
  CL: 'Casual Leave',
  SL: 'Sick Leave',
  EL: 'Earned Leave',
  WFH: 'Work From Home',
  COMP_OFF: 'Comp Off',
  MATERNITY: 'Maternity Leave',
  PATERNITY: 'Paternity Leave',
  UNPAID: 'Unpaid Leave',
  OTHER: 'Other Leave',
};

export function leaveTypeLabel(code, fallbackName) {
  if (fallbackName) return fallbackName;
  const c = String(code || '').toUpperCase();
  return LEAVE_TYPE_LABELS[c] || c.replace(/_/g, ' ');
}

export function mapLeaveFromApi(row) {
  if (!row) return null;
  const c = toCamelCase(row);
  const emp = c.employee || {};
  const leaveType = c.leaveType;
  return {
    id: c.id,
    employeeId: c.employeeId,
    employeeName: emp.firstName ? `${emp.firstName} ${emp.lastName}`.trim() : undefined,
    managerId: emp.managerId || null,
    type: leaveType,
    leaveType,
    label: leaveTypeLabel(leaveType),
    from: c.fromDate,
    to: c.toDate,
    days: Number(c.totalDays || 0),
    reason: c.reason || '',
    status: c.status,
    appliedOn: c.createdAt,
    isHalfDay: c.isHalfDay,
    managerApprovedBy: c.managerApprovedBy || null,
    managerApprovedAt: c.managerApprovedAt || null,
  };
}

export function mapLeaveBalanceFromApi(rows = []) {
  const balances = {};
  const items = [];
  for (const row of rows) {
    const c = toCamelCase(row);
    const code = String(c.leaveType || '').toUpperCase();
    if (!code) continue;
    const total = Number(c.totalAllocated || 0);
    const used = Number(c.used || 0);
    const remaining = Number(c.available ?? (total - used - Number(c.encashed || 0)));
    const name = leaveTypeLabel(code, c.name || c.leaveTypeName);
    const item = { code, name, total, used, remaining };
    items.push(item);
    // Keep code as primary key; also mirror legacy keys for older UI
    balances[code] = item;
    const legacy = LEAVE_BALANCE_KEYS[code];
    if (legacy) balances[legacy] = item;
  }
  return { year: new Date().getFullYear(), balances, items };
}

export function mapAttendanceFromApi(row) {
  if (!row) return null;
  const c = toCamelCase(row);
  const checkIn = c.checkInTime ? new Date(c.checkInTime) : null;
  const checkOut = c.checkOutTime ? new Date(c.checkOutTime) : null;
  const tzOpts = { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
  const date = checkIn
    ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(checkIn)
    : c.date;
  const emp = c.employee || {};
  const employeeName = emp.firstName
    ? `${emp.firstName} ${emp.lastName || ''}`.trim()
    : c.employeeName;
  let status = c.status;
  if (status === 'early_departure') status = 'present';
  const loc = c.location && typeof c.location === 'object' ? c.location : {};
  if (status === 'wfh' || loc.is_wfh || loc.wfh) status = 'wfh';
  return {
    id: c.id,
    employeeId: c.employeeId,
    employeeName,
    department: emp.department || c.department || '',
    designation: emp.designation || '',
    employeeCode: emp.employeeCode || '',
    attendanceMode: emp.attendanceMode || c.attendanceMode || 'office',
    date,
    status,
    isWfh: status === 'wfh' || Boolean(loc.is_wfh || loc.isWfh || loc.wfh),
    checkIn: checkIn ? new Intl.DateTimeFormat('en-GB', tzOpts).format(checkIn) : null,
    checkOut: checkOut ? new Intl.DateTimeFormat('en-GB', tzOpts).format(checkOut) : null,
    checkInAt: c.checkInTime || null,
    checkOutAt: c.checkOutTime || null,
    checkInIp: c.checkInIp || null,
    checkOutIp: c.checkOutIp || null,
    checkInMethod: c.checkInMethod || null,
    checkOutMethod: c.checkOutMethod || null,
    isAutoCheckout: Boolean(c.isAutoCheckout),
    workHours: Number(c.totalHours || c.workHours || 0),
    overtime: Number(c.overtimeHours || 0),
  };
}

export function mapTodayStatusFromApi(data) {
  const c = toCamelCase(data || {});
  return {
    status: c.status,
    checkIn: c.checkInLabel || (c.checkInTime ? new Date(c.checkInTime).toTimeString().slice(0, 5) : null),
    checkOut: c.checkOutTime ? new Date(c.checkOutTime).toTimeString().slice(0, 5) : null,
    canCheckIn: c.canCheckIn,
    canCheckOut: c.canCheckOut,
    label: c.label,
  };
}

export function mapLast7DaysFromApi(days = []) {
  return days.map((d) => ({
    date: d.date,
    status: d.state === 'none' ? 'weekend' : d.state,
    dayLabel: d.dayLabel,
  }));
}

export function mapPayslipFromApi(row) {
  if (!row) return null;
  const c = toCamelCase(row);
  const breakdown = c.breakdownJson || {};
  const earningsArr = Array.isArray(breakdown.earnings) ? breakdown.earnings : [];
  const deductionsArr = Array.isArray(breakdown.deductions) ? breakdown.deductions : [];
  const findAmt = (rows, ...names) => {
    const want = names.map((n) => n.toLowerCase());
    const hit = rows.find((r) => want.includes(String(r.name || '').toLowerCase()));
    return Number(hit?.amount || 0);
  };
  const earningsObj = typeof breakdown.earnings === 'object' && !Array.isArray(breakdown.earnings)
    ? breakdown.earnings
    : {};
  const deductionsObj = typeof breakdown.deductions === 'object' && !Array.isArray(breakdown.deductions)
    ? breakdown.deductions
    : {};
  const totals = breakdown.totals || {};
  const monthStr = `${c.year}-${String(c.month).padStart(2, '0')}`;
  const pf = Number(c.pfDeduction ?? (findAmt(deductionsArr, 'pf') || deductionsObj.pf || 0));
  const pt = Number(c.ptDeduction ?? (findAmt(deductionsArr, 'professional tax', 'pt') || deductionsObj.pt || 0));
  const lop = Number(c.lopDeduction ?? (findAmt(deductionsArr, 'lop') || 0));
  const tds = Number(findAmt(deductionsArr, 'tds') || deductionsObj.tds || 0);
  const esic = Number(findAmt(deductionsArr, 'esi', 'esic') || deductionsObj.esic || 0);
  const totalDed = Number(
    totals.total_deductions
      ?? totals.totalDeductions
      ?? deductionsArr.reduce((s, d) => s + Number(d.amount || 0), 0)
      ?? (pf + pt + lop + tds + esic)
  );
  const reimbursementsArr = Array.isArray(breakdown.reimbursements) ? breakdown.reimbursements : [];
  const totalReimb = Number(
    totals.total_reimbursements
    ?? totals.totalReimbursements
    ?? reimbursementsArr.reduce((s, r) => s + Number(r.amount || 0), 0)
  );
  const meta = breakdown.meta || {};
  const netPayable = Number(totals.net_payable ?? totals.netPayable ?? ((c.netPay ?? c.netSalary ?? totals.net_pay ?? 0) + totalReimb));
  return {
    id: c.id,
    month: monthStr,
    year: c.year,
    monthNum: c.month,
    netPay: netPayable,
    salaryNetPay: Number(c.netPay ?? c.netSalary ?? totals.net_pay ?? 0),
    grossPay: Number(c.grossSalary ?? totals.gross_salary ?? 0),
    status: String(c.payslipStatus || c.status || c.paymentStatus || 'pending').toLowerCase(),
    payslipStatus: c.payslipStatus || c.status,
    paymentStatus: c.paymentStatus,
    earnings: {
      basic: Number(c.basicSalary ?? (findAmt(earningsArr, 'basic') || earningsObj.basic || 0)),
      hra: Number(c.hra ?? (findAmt(earningsArr, 'hra') || earningsObj.hra || 0)),
      da: Number(findAmt(earningsArr, 'da') || earningsObj.da || 0),
      specialAllowance: Number(findAmt(earningsArr, 'special allowance', 'special') || earningsObj.special || 0),
      incentive: Number(findAmt(earningsArr, 'incentive') || earningsObj.incentive || 0),
      gross: Number(c.grossSalary ?? totals.gross_salary ?? (earningsObj.gross || 0)),
      lines: earningsArr,
    },
    deductions: {
      pf,
      esic,
      pt,
      tds,
      lop,
      total: totalDed,
      lines: deductionsArr,
    },
    reimbursements: {
      lines: reimbursementsArr,
      total: totalReimb,
    },
    unpaidLeaveDays: Number(meta.lopDays ?? meta.lop_days ?? c.unpaidLeaveDays ?? 0),
    paidDays: Number(meta.paidDays ?? meta.paid_days ?? 0),
    ctc: Number(meta.ctc || 0),
    payMethod: meta.payMethod || meta.pay_method || '',
    accountNumber: meta.accountNumber || meta.account_number || '',
    designation: meta.designation || '',
    dateOfJoining: meta.dateOfJoining || meta.date_of_joining || '',
    employeeName: meta.employeeName || meta.employee_name || '',
    payslipUrl: c.payslipUrl,
    employeeId: c.employeeId || c.userId,
    paidOn: c.paidOn || c.updatedAt,
    breakdown,
  };
}

export function mapReimbursementFromApi(row) {
  if (!row) return null;
  const c = toCamelCase(row);
  const emp = c.employee || {};
  return {
    id: c.id,
    employeeId: c.employeeId,
    employeeName: emp.firstName ? `${emp.firstName} ${emp.lastName}`.trim() : undefined,
    category: (c.reimbursementType || c.category || 'other').replace(/_/g, '-'),
    reimbursementType: c.reimbursementType,
    date: c.expenseDate || c.createdAt?.slice(0, 10),
    amount: Number(c.amount || 0),
    currency: c.currency || 'INR',
    description: c.description || '',
    status: c.status,
    submittedOn: c.createdAt,
    approvedBy: c.approvedBy,
    receiptUrl: c.receiptUrl,
  };
}

export function mapAnnouncementFromApi(row) {
  if (!row) return null;
  const c = toCamelCase(row);
  const attachmentUrl = c.attachmentUrl || null;
  return {
    id: c.id,
    title: c.title,
    body: c.content || c.body || '',
    priority: c.priority || 'medium',
    status: c.isActive === false ? 'draft' : 'published',
    pendingApproval: Boolean(c.pendingApproval ?? c.pending_approval),
    publishedAt: c.publishedAt || c.createdAt,
    audience: c.targetAudience || c.audience || 'all',
    createdBy: c.publishedBy || c.createdBy || c.authorId,
    attachmentUrl,
    attachments: attachmentUrl
      ? [{ name: String(attachmentUrl).split('/').pop(), url: attachmentUrl }]
      : [],
    isAcknowledged: Boolean(c.isAcknowledged),
  };
}

export function mapHolidayFromApi(row) {
  if (!row) return null;
  const c = toCamelCase(row);
  return {
    id: c.id,
    name: c.title || c.name,
    date: c.date,
    type: c.type || c.holidayType || 'public',
  };
}

export function mapAssetFromApi(row) {
  if (!row) return null;
  const c = toCamelCase(row);
  return {
    id: c.id,
    name: c.name,
    category: c.category,
    brand: c.brand,
    model: c.model,
    serialNumber: c.serialNumber,
    purchaseDate: c.purchaseDate,
    purchaseCost: Number(c.purchaseCost || 0),
    currentValue: Number(c.currentValue ?? c.purchaseCost ?? 0),
    depreciationMethod: c.depreciationMethod || null,
    depreciationYears: c.depreciationYears != null ? Number(c.depreciationYears) : null,
    exitRecovery: Boolean(c.exitRecovery),
    exitRecoveryReminderDays: Number(c.exitRecoveryReminderDays ?? 7),
    warrantyExpiry: c.warrantyExpiry,
    status: c.status,
    assignedTo: c.assignedTo,
    assignedOn: c.assignedOn,
    location: c.location,
  };
}

export function mapAssetRequestFromApi(row) {
  if (!row) return null;
  const c = toCamelCase(row);
  return {
    id: c.id,
    employeeId: c.employeeId,
    assetType: c.assetType,
    reason: c.reason,
    urgency: c.urgency,
    status: c.status,
    requestedOn: c.requestedOn,
  };
}

export function mapTicketFromApi(row) {
  if (!row) return null;
  const c = toCamelCase(row);
  return {
    id: c.id,
    raisedBy: c.raisedBy,
    subject: c.subject,
    category: c.category,
    priority: c.priority,
    status: c.status,
    description: c.description || '',
    assignedTo: c.assignedTo,
    comments: c.comments || [],
    createdAt: c.createdAt,
    resolvedAt: c.resolvedAt,
    slaDueBy: c.slaDueBy,
  };
}

export function mapJobFromApi(row) {
  if (!row) return null;
  const c = toCamelCase(row);
  const status = c.status === 'open' ? 'active' : (c.status || 'active');
  return {
    id: c.id,
    title: c.title,
    department: c.department,
    location: c.location,
    type: (c.type || c.employmentType || 'full_time').replace(/_/g, '-'),
    status,
    openings: Number(c.openings || 1),
    description: c.description || '',
    createdAt: c.createdAt,
  };
}

export function mapCandidateFromApi(row) {
  if (!row) return null;
  const c = toCamelCase(row);
  return {
    id: c.id,
    jobId: c.jobId,
    name: c.name,
    email: c.email,
    phone: c.phone || '',
    source: c.source || '',
    resumeUrl: c.resumeUrl || '',
    stage: c.stage,
    daysInStage: Number(c.daysInStage || 0),
    appliedOn: c.appliedOn,
  };
}

export function mapGoalFromApi(row) {
  if (!row) return null;
  const c = toCamelCase(row);
  return {
    id: c.id,
    employeeId: c.employeeId,
    title: c.title,
    cycle: c.cycle,
    progress: Number(c.progress || 0),
    status: c.status,
    dueDate: c.dueDate,
  };
}
