/**
 * Recursively map object keys between snake_case (API) and camelCase (UI).
 */

function toCamelKey(key) {
  return key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

function toSnakeKey(key) {
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

export function toCamelCase(value) {
  if (Array.isArray(value)) return value.map(toCamelCase);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [toCamelKey(k), toCamelCase(v)])
    );
  }
  return value;
}

export function toSnakeCase(value) {
  if (Array.isArray(value)) return value.map(toSnakeCase);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [toSnakeKey(k), toSnakeCase(v)])
    );
  }
  return value;
}

/** Map a backend employee record to the shape the HRMS UI expects. */
export function mapEmployeeFromApi(emp) {
  if (!emp) return null;
  const c = toCamelCase(emp);
  const firstName = c.firstName || '';
  const lastName = c.lastName || '';
  const sd = c.salaryDetails || {};
  const bank = c.bankDetails || {};
  const ec = c.emergencyContact || {};
  const addr = c.address || {};
  const addressStr = typeof addr === 'string' ? addr : [addr.line1, addr.line2, addr.city].filter(Boolean).join(', ');
  const attendanceMode = String(
    c.attendanceMode || addr.attendanceMode || addr.attendance_mode || 'office'
  ).toLowerCase();
  return {
    ...c,
    id: c.id,
    employeeCode: c.employeeCode,
    firstName,
    lastName,
    name: `${firstName} ${lastName}`.trim(),
    workEmail: c.email,
    workLocation: c.workLocation || c.location || addr.workLocation || addr.work_location || addr.city || '',
    shift: c.shift || addr.shift || '',
    shiftId: c.shiftId || addr.shift_id || addr.shiftId || '',
    attendanceMode: attendanceMode === 'wfh' || attendanceMode === 'remote'
      ? 'wfh'
      : attendanceMode === 'hybrid'
        ? 'hybrid'
        : 'office',
    personalEmail: c.personalEmail || addr.personalEmail || addr.personal_email || c.email,
    joinDate: c.dateOfJoining || c.joinDate,
    dob: c.dateOfBirth || c.dob,
    status: c.isActive === false ? 'resigned' : (c.status || 'active'),
    employmentType: (c.employmentType || 'full_time').replace(/_/g, '-'),
    role: c.role || 'employee',
    department: c.department || '',
    designation: c.designation || '',
    companyId: c.companyId || c.company?.id || null,
    companyName: c.companyName || c.company?.name || '',
    companyType: c.companyType || c.company?.companyType || c.company?.company_type || '',
    avatar: c.profilePictureUrl || c.profilePicture || c.avatar || null,
    reportingTo: c.managerId || c.reportingTo,
    manager: c.manager,
    salary: {
      basic: Number(sd.basic || 0),
      hra: Number(sd.hra || 0),
      da: Number(sd.da || 0),
      special: Number(sd.special || 0),
      transport: Number(sd.transport || 0),
      medical: Number(sd.medical || 0),
      pf: Number(sd.pf ?? Math.round(Number(sd.basic || 0) * 0.12)),
      pt: Number(sd.pt ?? sd.professionalTax ?? 200),
      tds: Number(sd.tds ?? 0),
      custom: sd.custom && typeof sd.custom === 'object' ? sd.custom : {},
      esic: Number(sd.esic || sd.esi || 0),
      salaryPeriod: sd.salaryPeriod || sd.salary_period || 'monthly',
      pfApplicable: sd.pfApplicable !== false,
      ptApplicable: sd.ptApplicable !== false,
      esiApplicable: sd.esiApplicable !== false,
      pfPercent: sd.pfPercent ?? '',
      tdsMode: sd.tdsMode || 'company',
      tdsFixed: Number(sd.tdsFixed ?? 0),
    },
    bank: {
      name: bank.bankName || bank.name || '',
      account: bank.accountNumber || bank.account || '',
      ifsc: bank.ifsc || '',
    },
    emergencyContact: {
      name: ec.name || '',
      phone: ec.phone || '',
      relation: ec.relation || ec.relationship || '',
    },
    address: addressStr,
    addressRaw: typeof addr === 'object' ? addr : { line1: addressStr },
  };
}

export function unwrapApiData(response) {
  const body = response?.data;
  if (body && typeof body === 'object' && 'success' in body) {
    if (!body.success) {
      const msg = body.error?.message || body.message || 'Request failed';
      throw new Error(msg);
    }
    return toCamelCase(body.data);
  }
  return toCamelCase(body);
}
