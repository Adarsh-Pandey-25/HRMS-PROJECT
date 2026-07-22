/**
 * Seed Company 2 ("bon") with 20 employees + rich related data for module testing.
 * Company UUID: 9da62562-8e10-4fa8-9660-f92fa0a5204b
 *
 * Keeps existing: bondon@gmail.com (admin), aaru.batu@spaxads.com (manager)
 *
 * Run: node scripts/seed-company2-test-data.js
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const moment = require('moment-timezone');
const { createClient } = require('@supabase/supabase-js');
const { generateDefaultPassword } = require('../src/utils/helpers');
const { TIMEZONE } = require('../src/utils/constants');
const { companyIdFields } = require('../src/utils/tenant');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const COMPANY_ID = '9da62562-8e10-4fa8-9660-f92fa0a5204b';
const YEAR = 2026;
const TZ = TIMEZONE || 'Asia/Kolkata';

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const round2 = (n) => Math.round(Number(n) * 100) / 100;

/** 20 new people for company 2 — unique @bon.test emails */
const NEW_EMPLOYEES = [
  // Extra managers (aaru already exists as manager)
  { email: 'kiran.rao@bon.test', first_name: 'Kiran', last_name: 'Rao', role: 'manager', department: 'Engineering', designation: 'Engineering Manager', salary: { basic: 85000, hra: 34000, da: 4000, special: 7000 } },
  { email: 'sneha.kapoor@bon.test', first_name: 'Sneha', last_name: 'Kapoor', role: 'manager', department: 'Sales', designation: 'Sales Manager', salary: { basic: 78000, hra: 31200, da: 3500, special: 6000 } },
  { email: 'vivek.nair@bon.test', first_name: 'Vivek', last_name: 'Nair', role: 'hr', department: 'Human Resources', designation: 'HR Manager', salary: { basic: 72000, hra: 28800, da: 3000, special: 5000 } },

  // Engineering → Kiran
  { email: 'dev.malhotra@bon.test', first_name: 'Dev', last_name: 'Malhotra', role: 'employee', department: 'Engineering', designation: 'Senior Developer', managerDept: 'Engineering', salary: { basic: 62000, hra: 24800, da: 2800, special: 4500 } },
  { email: 'riya.sen@bon.test', first_name: 'Riya', last_name: 'Sen', role: 'employee', department: 'Engineering', designation: 'Frontend Developer', managerDept: 'Engineering', salary: { basic: 52000, hra: 20800, da: 2200, special: 3500 } },
  { email: 'harsh.gupta@bon.test', first_name: 'Harsh', last_name: 'Gupta', role: 'employee', department: 'Engineering', designation: 'Backend Developer', managerDept: 'Engineering', salary: { basic: 55000, hra: 22000, da: 2400, special: 4000 } },
  { email: 'anki.jain@bon.test', first_name: 'Anki', last_name: 'Jain', role: 'employee', department: 'Engineering', designation: 'QA Engineer', managerDept: 'Engineering', salary: { basic: 45000, hra: 18000, da: 2000, special: 3000 } },
  { email: 'yash.bhatt@bon.test', first_name: 'Yash', last_name: 'Bhatt', role: 'employee', department: 'Engineering', designation: 'DevOps Engineer', managerDept: 'Engineering', salary: { basic: 58000, hra: 23200, da: 2500, special: 4200 } },

  // Sales → Sneha (also aaru can manage)
  { email: 'neha.das@bon.test', first_name: 'Neha', last_name: 'Das', role: 'employee', department: 'Sales', designation: 'Sales Executive', managerDept: 'Sales', salary: { basic: 40000, hra: 16000, da: 1800, special: 2800 } },
  { email: 'raj.khanna@bon.test', first_name: 'Raj', last_name: 'Khanna', role: 'employee', department: 'Sales', designation: 'Account Manager', managerDept: 'Sales', salary: { basic: 48000, hra: 19200, da: 2000, special: 3200 } },
  { email: 'pooja.nair@bon.test', first_name: 'Pooja', last_name: 'Nair', role: 'employee', department: 'Sales', designation: 'BD Executive', managerDept: 'Sales', salary: { basic: 38000, hra: 15200, da: 1600, special: 2500 } },
  { email: 'amit.shah@bon.test', first_name: 'Amit', last_name: 'Shah', role: 'employee', department: 'Sales', designation: 'Sales Associate', managerDept: 'Sales', salary: { basic: 36000, hra: 14400, da: 1500, special: 2200 } },

  // Finance / Ops → Sneha or Kiran
  { email: 'lara.menon@bon.test', first_name: 'Lara', last_name: 'Menon', role: 'employee', department: 'Finance', designation: 'Accountant', managerDept: 'Sales', salary: { basic: 50000, hra: 20000, da: 2200, special: 3400 } },
  { email: 'om.prakash@bon.test', first_name: 'Om', last_name: 'Prakash', role: 'employee', department: 'Finance', designation: 'Payroll Associate', managerDept: 'Sales', salary: { basic: 42000, hra: 16800, da: 1800, special: 2800 } },
  { email: 'tina.roy@bon.test', first_name: 'Tina', last_name: 'Roy', role: 'employee', department: 'Operations', designation: 'Ops Coordinator', managerDept: 'Engineering', salary: { basic: 35000, hra: 14000, da: 1500, special: 2000 } },
  { email: 'kabir.ali@bon.test', first_name: 'Kabir', last_name: 'Ali', role: 'employee', department: 'Operations', designation: 'Office Admin', managerDept: 'Engineering', salary: { basic: 32000, hra: 12800, da: 1400, special: 1800 } },

  // Marketing / more eng
  { email: 'isha.verma@bon.test', first_name: 'Isha', last_name: 'Verma', role: 'employee', department: 'Marketing', designation: 'Content Lead', managerDept: 'Sales', salary: { basic: 44000, hra: 17600, da: 1900, special: 3000 } },
  { email: 'ronit.das@bon.test', first_name: 'Ronit', last_name: 'Das', role: 'employee', department: 'Marketing', designation: 'Social Media', managerDept: 'Sales', salary: { basic: 39000, hra: 15600, da: 1700, special: 2600 } },
  { email: 'mehak.singh@bon.test', first_name: 'Mehak', last_name: 'Singh', role: 'employee', department: 'Engineering', designation: 'Mobile Developer', managerDept: 'Engineering', salary: { basic: 54000, hra: 21600, da: 2300, special: 3800 } },
  { email: 'zara.khan@bon.test', first_name: 'Zara', last_name: 'Khan', role: 'employee', department: 'Human Resources', designation: 'HR Executive', managerDept: 'Sales', salary: { basic: 41000, hra: 16400, da: 1800, special: 2700 } },
];

const LEAVE_ALLOC = { CL: 12, SL: 12, EL: 15, WFH: 24 };
const DOC_TYPES = ['offer_letter', 'joining_letter', 'aadhar', 'pan', 'educational_certificate'];
const REIMB_TYPES = ['travel', 'food', 'medical', 'internet_phone', 'office_supplies', 'other'];
const ASSET_TYPES = ['Laptop', 'Monitor', 'Headset', 'Mobile Phone', 'Keyboard', 'Mouse'];

async function upsertEmployee(emp, managerId = null) {
  const { data: existing } = await supabase.from('employees').select('id').eq('email', emp.email).maybeSingle();
  const passwordHash = await bcrypt.hash(generateDefaultPassword(emp.first_name, emp.last_name), 10);
  const tenant = companyIdFields(COMPANY_ID, {});

  if (existing) {
    await supabase.from('employees').update({
      password_hash: passwordHash,
      role: emp.role,
      department: emp.department,
      designation: emp.designation,
      manager_id: emp.role === 'employee' ? managerId : null,
      is_active: true,
      salary_details: emp.salary,
      employment_type: 'full_time',
      ...tenant,
    }).eq('id', existing.id);
    console.log(`  ~ updated ${emp.first_name} ${emp.last_name}`);
    return existing.id;
  }

  const { data, error } = await supabase.from('employees').insert({
    email: emp.email,
    first_name: emp.first_name,
    last_name: emp.last_name,
    role: emp.role,
    department: emp.department,
    designation: emp.designation,
    employee_code: `BON${rand(10000, 99999)}`,
    password_hash: passwordHash,
    manager_id: emp.role === 'employee' ? managerId : null,
    date_of_joining: moment().tz(TZ).subtract(rand(30, 600), 'days').format('YYYY-MM-DD'),
    employment_type: 'full_time',
    gender: pick(['male', 'female', 'other']),
    phone: `9${rand(100000000, 999999999)}`,
    is_active: true,
    salary_details: emp.salary || { basic: 45000, hra: 18000, da: 2000, special: 3000 },
    ...tenant,
  }).select('id').single();

  if (error) throw new Error(`${emp.email}: ${error.message}`);
  console.log(`  + ${emp.role} ${emp.first_name} ${emp.last_name} <${emp.email}>`);
  return data.id;
}

async function seedEmployees(existingAaruId) {
  console.log('\n=== Employees (20 new for company bon) ===');
  const byDeptManager = {};

  for (const emp of NEW_EMPLOYEES.filter((e) => e.role === 'manager' || e.role === 'hr')) {
    const id = await upsertEmployee(emp, null);
    if (emp.department) byDeptManager[emp.department] = id;
  }
  // Existing aaru batu as Sales/general manager fallback
  if (existingAaruId) {
    byDeptManager.Sales = byDeptManager.Sales || existingAaruId;
    byDeptManager.Marketing = byDeptManager.Marketing || existingAaruId;
  }

  for (const emp of NEW_EMPLOYEES) {
    if (emp.role === 'manager' || emp.role === 'hr') continue;
    const mgrId = byDeptManager[emp.managerDept] || byDeptManager.Engineering || existingAaruId;
    await upsertEmployee(emp, mgrId);
  }

  // Point aaru at Engineering manager if present
  if (existingAaruId && byDeptManager.Engineering) {
    await supabase.from('employees').update({
      manager_id: null,
      department: 'Sales',
      designation: 'Sales Manager',
      salary_details: { basic: 75000, hra: 30000, da: 3500, special: 5500 },
      ...companyIdFields(COMPANY_ID, {}),
    }).eq('id', existingAaruId);
  }

  const { data: all } = await supabase
    .from('employees')
    .select('id, role, first_name, last_name, email, department, manager_id, salary_details, company_id')
    .eq('company_id', COMPANY_ID)
    .eq('is_active', true)
    .order('first_name');

  return { all: all || [], byDeptManager };
}

async function seedLeaveBalances(employeeIds) {
  console.log('\n=== Leave balances ===');
  let n = 0;
  for (const empId of employeeIds) {
    for (const [type, alloc] of Object.entries(LEAVE_ALLOC)) {
      const used = type === 'CL' ? rand(0, 3) : type === 'SL' ? rand(0, 2) : rand(0, 1);
      const { error } = await supabase.from('leave_balances').upsert({
        employee_id: empId,
        year: YEAR,
        leave_type: type,
        total_allocated: alloc,
        used,
        encashed: 0,
      }, { onConflict: 'employee_id,year,leave_type' });
      if (!error) n += 1;
    }
  }
  console.log(`  + ${n} balance rows`);
}

async function seedAttendance(employeeIds) {
  console.log('\n=== Attendance (Jun + Jul weekdays) ===');
  let inserted = 0;
  const start = moment.tz(`${YEAR}-06-01`, TZ);
  const end = moment.tz(TZ);

  for (const empId of employeeIds) {
    const absPattern = empId.charCodeAt(0) % 5;
    for (let d = start.clone(); d.isSameOrBefore(end, 'day'); d.add(1, 'day')) {
      if (d.day() === 0 || d.day() === 6) continue;
      const dateStr = d.format('YYYY-MM-DD');
      const dayOfMonth = d.date();
      if (dayOfMonth === 5 + absPattern || dayOfMonth === 18 || (absPattern === 0 && dayOfMonth === 12)) continue;

      const { data: exists } = await supabase
        .from('attendance')
        .select('id')
        .eq('employee_id', empId)
        .gte('check_in_time', `${dateStr}T00:00:00+05:30`)
        .lt('check_in_time', `${dateStr}T23:59:59+05:30`)
        .limit(1);
      if (exists?.length) continue;

      let status = 'present';
      let inMin = rand(0, 20);
      let hours = pick([8, 8.5, 9, 9.5]);
      if (dayOfMonth % 11 === absPattern) { status = 'late'; inMin = rand(30, 55); }
      else if (dayOfMonth % 13 === absPattern) { status = 'half_day'; hours = 4.5; }
      else if (dayOfMonth % 17 === absPattern) { status = 'early_departure'; hours = 6.5; }

      const checkIn = d.clone().hour(9).minute(inMin).second(0);
      const checkOut = checkIn.clone().add(hours, 'hours').add(rand(0, 20), 'minutes');

      const { error } = await supabase.from('attendance').insert({
        employee_id: empId,
        check_in_time: checkIn.toISOString(),
        check_out_time: checkOut.toISOString(),
        check_in_method: 'web',
        check_out_method: 'web',
        total_hours: round2(hours),
        overtime_hours: hours > 9 ? round2(hours - 9) : 0,
        break_minutes: rand(15, 45),
        status,
        remarks: status === 'late' ? 'Traffic delay' : null,
      });
      if (!error) inserted += 1;
    }
  }
  console.log(`  + ${inserted} attendance records`);
}

async function insertLeave(empId, managerIds, hrId, status) {
  const types = ['CL', 'SL', 'EL', 'WFH'];
  const reasons = ['Family function', 'Medical appointment', 'Personal work', 'Vacation', 'Not feeling well', 'Doctor visit'];
  const from = moment().tz(TZ).add(rand(-10, 20), 'days');
  while (from.day() === 0 || from.day() === 6) from.add(1, 'day');
  const days = pick([1, 1, 2, 3]);
  const to = from.clone().add(days - 1, 'days');
  const isHalf = days === 1 && pick([false, false, true]);
  const managerId = pick(managerIds);

  const row = {
    employee_id: empId,
    leave_type: pick(types),
    from_date: from.format('YYYY-MM-DD'),
    to_date: to.format('YYYY-MM-DD'),
    total_days: isHalf ? 0.5 : days,
    is_half_day: isHalf,
    reason: pick(reasons),
    status,
  };
  if (status === 'approved') {
    row.manager_approved_by = managerId;
    row.manager_approved_at = moment().subtract(rand(1, 8), 'days').toISOString();
    row.approved_by = hrId;
    row.approved_at = moment().subtract(rand(0, 3), 'days').toISOString();
  } else if (status === 'rejected') {
    row.rejection_reason = 'Team coverage insufficient';
    row.manager_approved_by = managerId;
  }
  const { error } = await supabase.from('leaves').insert(row);
  return !error;
}

async function seedLeaves(employeeIds, managerIds, hrId) {
  console.log('\n=== Leave requests ===');
  let n = 0;
  for (let i = 0; i < 10; i++) {
    if (await insertLeave(pick(employeeIds), managerIds, hrId, 'pending')) n += 1;
  }
  for (let i = 0; i < 20; i++) {
    const status = pick(['approved', 'approved', 'rejected']);
    if (await insertLeave(pick(employeeIds), managerIds, hrId, status)) n += 1;
  }
  console.log(`  + ${n} leave requests`);
}

function buildPayslip(emp, month, year, { unpaidDays = 0, publish = false } = {}) {
  const s = emp.salary_details || {};
  const basic = round2(Number(s.basic || 45000));
  const hra = round2(Number(s.hra || basic * 0.4));
  const da = round2(Number(s.da || 0));
  const special = round2(Number(s.special || 0));
  const gross = round2(basic + hra + da + special);
  const workingDays = 22;
  const lop = round2((gross / workingDays) * unpaidDays);
  const pf = round2(basic * 0.12);
  const pt = 200;
  const tds = round2(gross * 0.08);
  const esi = gross <= 21000 ? round2(gross * 0.0075) : 0;
  const earnings = [
    { name: 'Basic', amount: basic },
    { name: 'HRA', amount: hra },
  ];
  if (da > 0) earnings.push({ name: 'DA', amount: da });
  if (special > 0) earnings.push({ name: 'Special Allowance', amount: special });
  const deductions = [];
  if (lop > 0) deductions.push({ name: 'LOP', amount: lop });
  deductions.push({ name: 'PF', amount: pf }, { name: 'Professional Tax', amount: pt });
  if (tds > 0) deductions.push({ name: 'TDS', amount: tds });
  if (esi > 0) deductions.push({ name: 'ESI', amount: esi });
  const totalDed = round2(deductions.reduce((a, d) => a + d.amount, 0));
  const net = round2(Math.max(0, gross - totalDed));
  return {
    employee_id: emp.id,
    month,
    year,
    basic_salary: basic,
    hra,
    special_allowance: special,
    gross_salary: gross,
    pf_deduction: pf,
    professional_tax: pt,
    tds,
    esi_deduction: esi,
    lop_deduction: lop,
    unpaid_leave_days: unpaidDays,
    total_deductions: totalDed,
    net_salary: net,
    payment_status: publish ? 'paid' : 'pending',
    payment_date: publish ? `${year}-${String(month).padStart(2, '0')}-28` : null,
    payslip_status: publish ? 'PUBLISHED' : 'DRAFT',
    breakdown_json: {
      earnings,
      deductions,
      totals: { gross_salary: gross, total_deductions: totalDed, net_pay: net },
      config: { working_days: workingDays, unpaid_leave_days: unpaidDays },
    },
  };
}

async function seedPayroll(employees, adminId) {
  console.log('\n=== Payroll (June paid + July drafts) ===');
  for (const month of [6, 7]) {
    const { data: existing } = await supabase
      .from('payroll_months')
      .select('id')
      .eq('month', month)
      .eq('year', YEAR)
      .eq('company_id', COMPANY_ID)
      .maybeSingle();
    if (!existing) {
      await supabase.from('payroll_months').insert({
        month,
        year: YEAR,
        status: month === 6 ? 'COMPLETED' : 'PENDING',
        created_by: adminId,
        company_id: COMPANY_ID,
      });
    }
  }

  const { data: juneMonth } = await supabase.from('payroll_months').select('id').eq('month', 6).eq('year', YEAR).eq('company_id', COMPANY_ID).maybeSingle();
  const { data: julyMonth } = await supabase.from('payroll_months').select('id').eq('month', 7).eq('year', YEAR).eq('company_id', COMPANY_ID).maybeSingle();

  let n = 0;
  for (const emp of employees) {
    if (emp.role === 'admin') continue;
    for (const [month, monthId, publish, unpaid] of [
      [6, juneMonth?.id, true, rand(0, 2)],
      [7, julyMonth?.id, false, rand(0, 1)],
    ]) {
      const { data: exists } = await supabase
        .from('payroll')
        .select('id')
        .eq('employee_id', emp.id)
        .eq('month', month)
        .eq('year', YEAR)
        .maybeSingle();
      if (exists) continue;
      const row = buildPayslip(emp, month, YEAR, { unpaidDays: unpaid, publish });
      if (monthId) row.payroll_month_id = monthId;
      const { error } = await supabase.from('payroll').insert(row);
      if (!error) n += 1;
    }
  }
  console.log(`  + ${n} payslips`);
}

async function seedDocuments(employees, hrId) {
  console.log('\n=== Documents ===');
  let n = 0;
  for (const emp of employees) {
    if (emp.role === 'admin') continue;
    for (const docType of DOC_TYPES) {
      const { error } = await supabase.from('documents').insert({
        employee_id: emp.id,
        document_type: docType,
        document_name: `${docType} - ${emp.first_name}`,
        document_url: `https://placehold.co/600x800/png?text=${encodeURIComponent(docType)}`,
        uploaded_by: hrId,
        is_verified: pick([true, false]),
      });
      if (!error) n += 1;
    }
  }
  console.log(`  + ${n} documents`);
}

async function seedAssets(employees) {
  console.log('\n=== Assets ===');
  const pool = [
    { name: 'MacBook Air M2', category: 'Laptop', brand: 'Apple', cost: 115000 },
    { name: 'Dell Latitude', category: 'Laptop', brand: 'Dell', cost: 78000 },
    { name: 'LG 27 Monitor', category: 'Monitor', brand: 'LG', cost: 22000 },
    { name: 'Jabra Evolve', category: 'Headset', brand: 'Jabra', cost: 18000 },
    { name: 'iPhone 14', category: 'Mobile Phone', brand: 'Apple', cost: 69900 },
    { name: 'Logitech MX Keys', category: 'Keyboard', brand: 'Logitech', cost: 9995 },
  ];
  const staff = employees.filter((e) => e.role !== 'admin');
  let n = 0;
  for (let i = 0; i < pool.length; i++) {
    const item = pool[i];
    const assignee = staff[i] || null;
    const { error } = await supabase.from('assets').insert({
      name: item.name,
      category: item.category,
      brand: item.brand,
      model: item.name,
      serial_number: `BON-${rand(100000, 999999)}`,
      purchase_date: moment().subtract(rand(20, 400), 'days').format('YYYY-MM-DD'),
      purchase_cost: item.cost,
      warranty_expiry: moment().add(rand(100, 700), 'days').format('YYYY-MM-DD'),
      status: assignee ? 'assigned' : 'available',
      assigned_to: assignee?.id || null,
      assigned_on: assignee ? moment().subtract(rand(5, 100), 'days').format('YYYY-MM-DD') : null,
      location: 'Bon HQ',
      company_id: COMPANY_ID,
    });
    if (!error) n += 1;
  }
  console.log(`  + ${n} assets`);
}

async function seedAssetRequests(employeeIds) {
  console.log('\n=== Asset requests ===');
  let n = 0;
  let pending = 0;
  for (let i = 0; i < 12; i++) {
    const status = i < 7 ? 'requested' : pick(['approved', 'rejected']);
    const { error } = await supabase.from('asset_requests').insert({
      employee_id: pick(employeeIds),
      asset_type: pick(ASSET_TYPES),
      reason: pick(['Need for WFH', 'Replacement', 'New joiner kit', 'Broken device']),
      urgency: pick(['low', 'medium', 'high']),
      status,
      requested_on: moment().subtract(rand(0, 10), 'days').format('YYYY-MM-DD'),
      company_id: COMPANY_ID,
    });
    if (!error) {
      n += 1;
      if (status === 'requested') pending += 1;
    }
  }
  console.log(`  + ${n} requests (${pending} pending)`);
}

async function seedReimbursements(employeeIds, managerIds, hrId) {
  console.log('\n=== Reimbursements ===');
  let n = 0;
  for (let i = 0; i < 14; i++) {
    const status = i < 6 ? 'pending' : pick(['approved', 'rejected']);
    const managerId = pick(managerIds);
    const row = {
      employee_id: pick(employeeIds),
      reimbursement_type: pick(REIMB_TYPES),
      amount: rand(400, 9000),
      description: pick(['Client lunch', 'Cab fare', 'Internet', 'Medical bill', 'Stationery']),
      expense_date: moment().subtract(rand(1, 30), 'days').format('YYYY-MM-DD'),
      status,
      receipt_url: 'https://placehold.co/400x600/png?text=Receipt',
    };
    if (status === 'approved') {
      row.manager_approved_by = managerId;
      row.manager_approved_at = moment().subtract(2, 'days').toISOString();
      row.approved_by = hrId;
      row.approval_date = moment().toISOString();
      row.payment_date = moment().format('YYYY-MM-DD');
    } else if (status === 'rejected') {
      row.rejection_reason = 'Receipt unclear';
      row.manager_approved_by = managerId;
    }
    const { error } = await supabase.from('reimbursements').insert(row);
    if (!error) n += 1;
  }
  console.log(`  + ${n} claims`);
}

async function seedWfh(employeeIds, managerIds) {
  console.log('\n=== WFH requests ===');
  let n = 0;
  for (let i = 0; i < 8; i++) {
    const status = i < 4 ? 'pending' : pick(['approved', 'rejected']);
    const workDate = moment().add(rand(1, 12), 'days');
    while (workDate.day() === 0 || workDate.day() === 6) workDate.add(1, 'day');
    const row = {
      employee_id: pick(employeeIds),
      work_date: workDate.format('YYYY-MM-DD'),
      status,
      reason: pick(['Plumber visit', 'Family', 'Home delivery']),
    };
    if (status !== 'pending') {
      row.reviewed_by = pick(managerIds);
      row.reviewed_at = moment().toISOString();
    }
    const { error } = await supabase.from('wfh_day_requests').insert(row);
    if (!error) n += 1;
  }
  console.log(`  + ${n} WFH requests`);
}

async function seedHelpdesk(employeeIds, hrId) {
  console.log('\n=== Helpdesk ===');
  let n = 0;
  for (let i = 0; i < 8; i++) {
    const status = pick(['open', 'open', 'in_progress', 'resolved']);
    const { data, error } = await supabase.from('helpdesk_tickets').insert({
      raised_by: pick(employeeIds),
      subject: pick(['VPN issue', 'Payslip query', 'Leave balance', 'Laptop slow']),
      category: pick(['it', 'payroll', 'leave']),
      priority: pick(['low', 'medium', 'high']),
      status,
      description: 'Seeded ticket for company bon testing.',
      assigned_to: status === 'open' ? null : hrId,
      company_id: COMPANY_ID,
      sla_due_by: moment().add(2, 'days').toISOString(),
    }).select('id').single();
    if (!error && data?.id) n += 1;
  }
  console.log(`  + ${n} tickets`);
}

async function seedJobs() {
  console.log('\n=== Recruitment jobs ===');
  const jobs = [
    { title: 'React Developer', department: 'Engineering', location: 'Remote', openings: 2 },
    { title: 'Sales Executive', department: 'Sales', location: 'Mumbai', openings: 3 },
    { title: 'HR Intern', department: 'Human Resources', location: 'Delhi', openings: 1 },
  ];
  let n = 0;
  for (const j of jobs) {
    const { error } = await supabase.from('job_openings').insert({
      ...j,
      employment_type: 'full_time',
      status: 'open',
      company_id: COMPANY_ID,
    });
    if (!error) n += 1;
  }
  console.log(`  + ${n} job openings`);
}

async function seedHolidays(adminId) {
  console.log('\n=== Holidays ===');
  const list = [
    { title: 'Independence Day', date: '2026-08-15' },
    { title: 'Diwali', date: '2026-11-08' },
    { title: 'Christmas', date: '2026-12-25' },
  ];
  let n = 0;
  for (const h of list) {
    const { data: exists } = await supabase
      .from('holidays')
      .select('id')
      .eq('date', h.date)
      .eq('company_id', COMPANY_ID)
      .maybeSingle();
    if (exists) continue;
    const { error } = await supabase.from('holidays').insert({
      ...h,
      type: 'public',
      description: h.title,
      created_by: adminId,
      company_id: COMPANY_ID,
    });
    if (!error) n += 1;
  }
  console.log(`  + ${n} holidays`);
}

async function seedAnnouncement(adminId) {
  console.log('\n=== Announcement ===');
  const { error } = await supabase.from('announcements').insert({
    title: 'Welcome to Bon workspace',
    content: 'Seeded announcement for multi-tenant testing. Configure leave & payroll in Settings.',
    priority: 'medium',
    target_audience: 'all',
    published_by: adminId,
    is_active: true,
    company_id: COMPANY_ID,
  });
  console.log(error ? `  warn: ${error.message}` : '  + 1 announcement');
}

async function main() {
  console.log(`Seeding Company 2 (${COMPANY_ID}) — bon...\n`);

  const { data: company } = await supabase.from('companies').select('id, name').eq('id', COMPANY_ID).maybeSingle();
  if (!company) throw new Error('Company not found. Run Phase 1 SQL first.');

  const { data: admin } = await supabase
    .from('employees')
    .select('id, email')
    .eq('company_id', COMPANY_ID)
    .eq('role', 'admin')
    .limit(1)
    .maybeSingle();
  if (!admin) throw new Error('No admin for this company (expected bondon@gmail.com)');

  const { data: aaru } = await supabase
    .from('employees')
    .select('id')
    .eq('company_id', COMPANY_ID)
    .ilike('email', 'aaru.batu%')
    .maybeSingle();

  const { all, byDeptManager } = await seedEmployees(aaru?.id);
  const staffIds = all.filter((e) => e.role !== 'admin').map((e) => e.id);
  const employeeOnlyIds = all.filter((e) => e.role === 'employee').map((e) => e.id);
  const managerIds = [
    ...Object.values(byDeptManager),
    ...(aaru?.id ? [aaru.id] : []),
  ].filter(Boolean);
  const hrId = all.find((e) => e.role === 'hr')?.id || admin.id;

  await seedHolidays(admin.id);
  await seedLeaveBalances(staffIds);
  await seedAttendance(staffIds);
  await seedLeaves(employeeOnlyIds.length ? employeeOnlyIds : staffIds, managerIds, hrId);
  await seedPayroll(all, admin.id);
  await seedDocuments(all, hrId);
  await seedAssets(all);
  await seedAssetRequests(employeeOnlyIds.length ? employeeOnlyIds : staffIds);
  await seedReimbursements(employeeOnlyIds.length ? employeeOnlyIds : staffIds, managerIds, hrId);
  await seedWfh(employeeOnlyIds.length ? employeeOnlyIds : staffIds, managerIds);
  await seedHelpdesk(staffIds, hrId);
  await seedJobs();
  await seedAnnouncement(admin.id);

  const { count: pendingLeaves } = await supabase
    .from('leaves')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')
    .in('employee_id', employeeOnlyIds.length ? employeeOnlyIds : staffIds);

  console.log(`\n✓ Company "${company.name}" ready`);
  console.log(`  People: ${all.length} (kept admin + manager + 20 new)`);
  console.log(`  Pending leave approvals: ${pendingLeaves ?? '?'}`);
  console.log('\nLogin (password = FirstNameLastName@123):');
  console.log('  bondon@gmail.com           / BonDon@123  (Admin)');
  console.log('  aaru.batu@spaxads.com      / AaruBatu@123  (Manager)');
  console.log('  kiran.rao@bon.test         / KiranRao@123  (Engineering Manager)');
  console.log('  vivek.nair@bon.test        / VivekNair@123  (HR)');
  console.log('  sneha.kapoor@bon.test      / SnehaKapoor@123  (Sales Manager)');
  console.log('  riya.sen@bon.test          / RiyaSen@123  (Employee)');
  console.log('\nTest:');
  console.log('  Leave Approvals · Asset Requests · Expense Approvals');
  console.log('  Team Attendance · Run Payroll (July drafts) · My Payslips (June)');
  console.log('  Recruitment jobs · Helpdesk · Settings (leave/payroll) for THIS company only');
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
