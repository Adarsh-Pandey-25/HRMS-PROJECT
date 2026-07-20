/**
 * Reset test data: delete all employees except core accounts, then seed 25 new
 * employees with attendance, leaves, payroll, documents, assets, reimbursements, etc.
 *
 * Kept accounts: System Admin, HR One, Neha Gupta, Deepak Chopra.
 *
 * Run: node scripts/seed-test-data.js
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const moment = require('moment-timezone');
const { createClient } = require('@supabase/supabase-js');
const { generateDefaultPassword } = require('../src/utils/helpers');
const { TIMEZONE } = require('../src/utils/constants');
const { withCompanyId, DEFAULT_COMPANY_ID } = require('../src/utils/tenant');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const YEAR = 2026;
const TZ = TIMEZONE || 'Asia/Kolkata';

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const round2 = (n) => Math.round(Number(n) * 100) / 100;

/** 25 new people: 3 managers + 22 employees */
const NEW_EMPLOYEES = [
  // Managers (reporting managers)
  { email: 'vikram.singh@company.com', first_name: 'Vikram', last_name: 'Singh', role: 'manager', department: 'Engineering', designation: 'Engineering Manager', salary: { basic: 90000, hra: 36000, da: 5000, special: 8000 } },
  { email: 'meera.shah@company.com', first_name: 'Meera', last_name: 'Shah', role: 'manager', department: 'Marketing', designation: 'Marketing Manager', salary: { basic: 82000, hra: 32800, da: 4000, special: 6000 } },
  { email: 'rahul.verma@company.com', first_name: 'Rahul', last_name: 'Verma', role: 'manager', department: 'Finance', designation: 'Finance Manager', salary: { basic: 88000, hra: 35200, da: 4500, special: 7000 } },

  // Engineering → Vikram
  { email: 'arjun.mehta@company.com', first_name: 'Arjun', last_name: 'Mehta', role: 'employee', department: 'Engineering', designation: 'Senior Developer', managerDept: 'Engineering', salary: { basic: 65000, hra: 26000, da: 3000, special: 5000 } },
  { email: 'kavya.iyer@company.com', first_name: 'Kavya', last_name: 'Iyer', role: 'employee', department: 'Engineering', designation: 'Frontend Developer', managerDept: 'Engineering', salary: { basic: 55000, hra: 22000, da: 2500, special: 4000 } },
  { email: 'rohan.desai@company.com', first_name: 'Rohan', last_name: 'Desai', role: 'employee', department: 'Engineering', designation: 'Backend Developer', managerDept: 'Engineering', salary: { basic: 58000, hra: 23200, da: 2500, special: 4500 } },
  { email: 'simran.kaur@company.com', first_name: 'Simran', last_name: 'Kaur', role: 'employee', department: 'Engineering', designation: 'QA Engineer', managerDept: 'Engineering', salary: { basic: 48000, hra: 19200, da: 2000, special: 3000 } },
  { email: 'pooja.bansal@company.com', first_name: 'Pooja', last_name: 'Bansal', role: 'employee', department: 'Engineering', designation: 'DevOps Engineer', managerDept: 'Engineering', salary: { basic: 62000, hra: 24800, da: 3000, special: 5000 } },
  { email: 'amit.patel@company.com', first_name: 'Amit', last_name: 'Patel', role: 'employee', department: 'Engineering', designation: 'Full Stack Developer', managerDept: 'Engineering', salary: { basic: 60000, hra: 24000, da: 2800, special: 4500 } },
  { email: 'nisha.rao@company.com', first_name: 'Nisha', last_name: 'Rao', role: 'employee', department: 'Engineering', designation: 'Mobile Developer', managerDept: 'Engineering', salary: { basic: 56000, hra: 22400, da: 2500, special: 4000 } },

  // Sales → Neha (existing)
  { email: 'aditya.nair@company.com', first_name: 'Aditya', last_name: 'Nair', role: 'employee', department: 'Sales', designation: 'Sales Executive', managerDept: 'Sales', salary: { basic: 42000, hra: 16800, da: 2000, special: 3000 } },
  { email: 'priya.reddy@company.com', first_name: 'Priya', last_name: 'Reddy', role: 'employee', department: 'Sales', designation: 'Account Manager', managerDept: 'Sales', salary: { basic: 50000, hra: 20000, da: 2200, special: 3500 } },
  { email: 'sanjay.malhotra@company.com', first_name: 'Sanjay', last_name: 'Malhotra', role: 'employee', department: 'Sales', designation: 'Sales Associate', managerDept: 'Sales', salary: { basic: 38000, hra: 15200, da: 1800, special: 2500 } },
  { email: 'ritu.saxena@company.com', first_name: 'Ritu', last_name: 'Saxena', role: 'employee', department: 'Sales', designation: 'Key Account Executive', managerDept: 'Sales', salary: { basic: 46000, hra: 18400, da: 2000, special: 3200 } },

  // Marketing → Meera
  { email: 'karthik.menon@company.com', first_name: 'Karthik', last_name: 'Menon', role: 'employee', department: 'Marketing', designation: 'Marketing Specialist', managerDept: 'Marketing', salary: { basic: 45000, hra: 18000, da: 2000, special: 3000 } },
  { email: 'divya.pillai@company.com', first_name: 'Divya', last_name: 'Pillai', role: 'employee', department: 'Marketing', designation: 'Content Writer', managerDept: 'Marketing', salary: { basic: 40000, hra: 16000, da: 1800, special: 2500 } },
  { email: 'isha.kapoor@company.com', first_name: 'Isha', last_name: 'Kapoor', role: 'employee', department: 'Marketing', designation: 'Social Media Manager', managerDept: 'Marketing', salary: { basic: 43000, hra: 17200, da: 1900, special: 2800 } },
  { email: 'varun.bhatia@company.com', first_name: 'Varun', last_name: 'Bhatia', role: 'employee', department: 'Marketing', designation: 'Brand Executive', managerDept: 'Marketing', salary: { basic: 41000, hra: 16400, da: 1800, special: 2600 } },

  // Finance → Rahul
  { email: 'suresh.kumar@company.com', first_name: 'Suresh', last_name: 'Kumar', role: 'employee', department: 'Finance', designation: 'Accountant', managerDept: 'Finance', salary: { basic: 52000, hra: 20800, da: 2200, special: 3500 } },
  { email: 'anjali.deshmukh@company.com', first_name: 'Anjali', last_name: 'Deshmukh', role: 'employee', department: 'Finance', designation: 'Payroll Executive', managerDept: 'Finance', salary: { basic: 48000, hra: 19200, da: 2000, special: 3000 } },
  { email: 'mohan.lala@company.com', first_name: 'Mohan', last_name: 'Lala', role: 'employee', department: 'Finance', designation: 'Accounts Associate', managerDept: 'Finance', salary: { basic: 36000, hra: 14400, da: 1500, special: 2000 } },

  // HR / Ops → Neha or HR
  { email: 'anita.joshi@company.com', first_name: 'Anita', last_name: 'Joshi', role: 'employee', department: 'Human Resources', designation: 'HR Associate', managerDept: 'Sales', salary: { basic: 46000, hra: 18400, da: 2000, special: 3000 } },
  { email: 'manish.agarwal@company.com', first_name: 'Manish', last_name: 'Agarwal', role: 'employee', department: 'Operations', designation: 'Operations Analyst', managerDept: 'Finance', salary: { basic: 44000, hra: 17600, da: 1900, special: 2800 } },
  { email: 'tanya.jain@company.com', first_name: 'Tanya', last_name: 'Jain', role: 'employee', department: 'Operations', designation: 'Office Coordinator', managerDept: 'Finance', salary: { basic: 35000, hra: 14000, da: 1500, special: 2000 } },
  { email: 'farhan.ali@company.com', first_name: 'Farhan', last_name: 'Ali', role: 'employee', department: 'Engineering', designation: 'Intern Developer', managerDept: 'Engineering', salary: { basic: 25000, hra: 10000, da: 1000, special: 1500 } },
];

const LEAVE_ALLOC = { CL: 12, SL: 12, EL: 15, WFH: 24 };

const KEEP_EMAILS = new Set([
  'admin@company.com',
  'hr1@company.com',
  'neha.gupta@company.com',
  'deepak.chopra@company.com',
]);

const DOC_TYPES = ['offer_letter', 'joining_letter', 'aadhar', 'pan', 'educational_certificate'];
const REIMB_TYPES = ['travel', 'food', 'medical', 'internet_phone', 'office_supplies', 'other'];
const ASSET_TYPES = ['Laptop', 'Monitor', 'Headset', 'Mobile Phone', 'Keyboard', 'Mouse'];

async function deleteByEmployeeIds(table, column, ids) {
  if (!ids.length) return;
  const { error } = await supabase.from(table).delete().in(column, ids);
  if (error) console.warn(`  warn ${table}:`, error.message);
  else console.log(`  cleared ${table}`);
}

async function pruneExtras() {
  console.log('\n=== Prune employees (keep System Admin, HR One, Neha, Deepak) ===');

  const { data: allEmps, error: listErr } = await supabase.from('employees').select('id, email');
  if (listErr) throw new Error(listErr.message);

  const keepIds = (allEmps || [])
    .filter((e) => KEEP_EMAILS.has(String(e.email || '').toLowerCase()))
    .map((e) => e.id);
  const deleteIds = (allEmps || [])
    .filter((e) => !KEEP_EMAILS.has(String(e.email || '').toLowerCase()))
    .map((e) => e.id);

  if (!keepIds.length) {
    throw new Error('No kept employees found. Run: node scripts/seed-admin.js');
  }

  if (!deleteIds.length) {
    console.log('  No extra employees to delete');
    return;
  }

  console.log(`  Removing ${deleteIds.length} employees, keeping ${keepIds.length}`);

  await supabase.from('employees').update({ manager_id: null }).in('id', keepIds);
  await supabase.from('assets').update({ assigned_to: null, status: 'available' }).in('assigned_to', deleteIds);
  await supabase.from('helpdesk_tickets').update({ raised_by: null }).in('raised_by', deleteIds);
  await supabase.from('helpdesk_tickets').update({ assigned_to: null }).in('assigned_to', deleteIds);
  await supabase.from('helpdesk_ticket_comments').delete().in('author_id', deleteIds);
  await supabase.from('performance_reviews').update({ manager_id: null }).in('manager_id', deleteIds);
  await supabase.from('leaves').update({ manager_approved_by: null, approved_by: null }).in('manager_approved_by', deleteIds);
  await supabase.from('leaves').update({ approved_by: null }).in('approved_by', deleteIds);
  await supabase.from('reimbursements').update({ manager_approved_by: null, approved_by: null }).in('manager_approved_by', deleteIds);
  await supabase.from('reimbursements').update({ approved_by: null }).in('approved_by', deleteIds);
  await supabase.from('wfh_day_requests').update({ reviewed_by: null }).in('reviewed_by', deleteIds);

  for (const [table, col] of [
    ['system_settings', 'updated_by'],
    ['payroll_months', 'created_by'],
    ['trainings', 'created_by'],
    ['holidays', 'created_by'],
    ['announcements', 'published_by'],
    ['documents', 'uploaded_by'],
    ['documents', 'verified_by'],
    ['employee_trainings', 'assigned_by'],
    ['courses', 'created_by'],
  ]) {
    const { error } = await supabase.from(table).update({ [col]: null }).in(col, deleteIds);
    if (error) console.warn(`  warn null ${table}.${col}:`, error.message);
  }

  for (const [table, col] of [
    ['refresh_tokens', 'employee_id'],
    ['password_reset_tokens', 'employee_id'],
    ['notifications', 'user_id'],
    ['announcement_acknowledgements', 'employee_id'],
    ['documents', 'employee_id'],
    ['leave_balances', 'employee_id'],
    ['attendance', 'employee_id'],
    ['leaves', 'employee_id'],
    ['payroll', 'employee_id'],
    ['reimbursements', 'employee_id'],
    ['employee_trainings', 'employee_id'],
    ['asset_requests', 'employee_id'],
    ['performance_goals', 'employee_id'],
    ['performance_reviews', 'employee_id'],
    ['wfh_day_requests', 'employee_id'],
    ['course_enrollments', 'employee_id'],
    ['course_enrollments', 'user_id'],
  ]) {
    await deleteByEmployeeIds(table, col, deleteIds);
  }

  const { error: delErr } = await supabase.from('employees').delete().in('id', deleteIds);
  if (delErr) throw new Error(`Delete employees: ${delErr.message}`);

  console.log(`  deleted ${deleteIds.length} employee records`);
}

async function upsertEmployee(emp, managerId = null) {
  const { data: existing } = await supabase.from('employees').select('id').eq('email', emp.email).maybeSingle();
  const passwordHash = await bcrypt.hash(generateDefaultPassword(emp.first_name, emp.last_name), 10);

  if (existing) {
    await supabase.from('employees').update({
      password_hash: passwordHash,
      role: emp.role,
      department: emp.department,
      designation: emp.designation,
      manager_id: emp.role === 'employee' ? managerId : null,
      is_active: true,
      salary_details: emp.salary,
      employment_type: emp.employment_type || 'full_time',
      address: withCompanyId({}, DEFAULT_COMPANY_ID),
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
    employee_code: `EMP${rand(20000, 99999)}`,
    password_hash: passwordHash,
    manager_id: emp.role === 'employee' ? managerId : null,
    date_of_joining: moment().tz(TZ).subtract(rand(60, 900), 'days').format('YYYY-MM-DD'),
    employment_type: emp.employment_type || 'full_time',
    gender: pick(['male', 'female', 'other']),
    phone: `9${rand(100000000, 999999999)}`,
    is_active: true,
    salary_details: emp.salary || { basic: 45000, hra: 18000, da: 2000, special: 3000 },
    address: withCompanyId({}, DEFAULT_COMPANY_ID),
  }).select('id').single();

  if (error) throw new Error(`${emp.email}: ${error.message}`);
  console.log(`  + ${emp.role} ${emp.first_name} ${emp.last_name} <${emp.email}>`);
  return data.id;
}

async function seedEmployees(nehaId) {
  console.log('\n=== Employees (25 new + wire managers) ===');
  const byDeptManager = {};

  // Create managers first
  for (const emp of NEW_EMPLOYEES.filter((e) => e.role === 'manager')) {
    const id = await upsertEmployee(emp, null);
    byDeptManager[emp.department] = id;
  }
  if (nehaId) byDeptManager.Sales = nehaId;

  const created = [];
  for (const emp of NEW_EMPLOYEES) {
    if (emp.role === 'manager') continue;
    const mgrId = byDeptManager[emp.managerDept] || byDeptManager.Engineering || nehaId;
    const id = await upsertEmployee(emp, mgrId);
    created.push(id);
  }

  // Wire existing Deepak → Neha
  if (nehaId) {
    await supabase.from('employees').update({
      manager_id: nehaId,
      salary_details: { basic: 47000, hra: 18800, da: 2000, special: 3200 },
      department: 'Sales',
      designation: 'Business Development',
      address: withCompanyId({}, DEFAULT_COMPANY_ID),
    }).eq('email', 'deepak.chopra@company.com');
  }
  // Ensure Neha has salary + Sales Manager
  if (nehaId) {
    await supabase.from('employees').update({
      department: 'Sales',
      designation: 'Sales Manager',
      salary_details: { basic: 78000, hra: 31200, da: 4000, special: 6000 },
      is_active: true,
    }).eq('id', nehaId);
  }

  const { data: all } = await supabase
    .from('employees')
    .select('id, role, first_name, last_name, email, department, manager_id, salary_details')
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
  const end = moment.tz(TZ); // today

  for (const empId of employeeIds) {
    // Every 5th employee: more absences for LOP testing
    const absPattern = empId.charCodeAt(0) % 5;

    for (let d = start.clone(); d.isSameOrBefore(end, 'day'); d.add(1, 'day')) {
      if (d.day() === 0 || d.day() === 6) continue;
      const dateStr = d.format('YYYY-MM-DD');

      // Skip ~2–4 weekdays/month to create absences
      const dayOfMonth = d.date();
      if (dayOfMonth === 5 + absPattern || dayOfMonth === 18 || (absPattern === 0 && dayOfMonth === 12)) {
        continue; // absent — no row
      }

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
      if (dayOfMonth % 11 === absPattern) {
        status = 'late';
        inMin = rand(30, 55);
      } else if (dayOfMonth % 13 === absPattern) {
        status = 'half_day';
        hours = 4.5;
      } else if (dayOfMonth % 17 === absPattern) {
        status = 'early_departure';
        hours = 6.5;
      }

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
        remarks: status === 'late' ? 'Traffic / metro delay' : null,
      });
      if (!error) inserted += 1;
    }
  }
  console.log(`  + ${inserted} check-in / check-out records`);
}

async function insertLeave(empId, managerIds, hrId, status) {
  const types = ['CL', 'SL', 'EL', 'WFH'];
  const reasons = [
    'Family function', 'Medical appointment', 'Personal work', 'Vacation',
    'WFH - home repair', 'Not feeling well', 'Doctor visit', 'Out of town',
  ];
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
    row.rejection_reason = 'Team coverage insufficient for that period';
    row.manager_approved_by = managerId;
  }

  const { error } = await supabase.from('leaves').insert(row);
  return !error;
}

async function seedLeaves(employeeIds, managerIds, hrId) {
  console.log('\n=== Leave requests ===');
  let n = 0;

  // Guaranteed pending queue for Leave Approvals UI
  for (let i = 0; i < 12; i++) {
    if (await insertLeave(pick(employeeIds), managerIds, hrId, 'pending')) n += 1;
  }

  for (let i = 0; i < 28; i++) {
    const status = pick(['approved', 'approved', 'approved', 'rejected']);
    if (await insertLeave(pick(employeeIds), managerIds, hrId, status)) n += 1;
  }

  console.log(`  + ${n} leave requests (12+ pending for approvals)`);
}

function buildPayslip(emp, month, year, { unpaidDays = 0, publish = false } = {}) {
  const s = emp.salary_details || {};
  const basic = round2(Number(s.basic || 45000));
  const hra = round2(Number(s.hra || basic * 0.4));
  const da = round2(Number(s.da || 0));
  const special = round2(Number(s.special || 0));
  let gross = round2(basic + hra + da + special);
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
  deductions.push({ name: 'PF', amount: pf });
  deductions.push({ name: 'Professional Tax', amount: pt });
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
      config: { working_days: workingDays, unpaid_leave_days: unpaidDays, pf_rate: 0.12, tds_percent: 8 },
    },
  };
}

async function seedPayroll(employees, adminId) {
  console.log('\n=== Payroll (June paid + July drafts) ===');

  // Ensure payroll months
  for (const month of [6, 7]) {
    const { data: existing } = await supabase
      .from('payroll_months')
      .select('id')
      .eq('month', month)
      .eq('year', YEAR)
      .maybeSingle();
    if (!existing) {
      await supabase.from('payroll_months').insert({
        month,
        year: YEAR,
        status: month === 6 ? 'COMPLETED' : 'PENDING',
        created_by: adminId,
      });
    }
  }

  const { data: juneMonth } = await supabase.from('payroll_months').select('id').eq('month', 6).eq('year', YEAR).maybeSingle();
  const { data: julyMonth } = await supabase.from('payroll_months').select('id').eq('month', 7).eq('year', YEAR).maybeSingle();

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
      else console.log('  payroll err', emp.first_name, error.message);
    }
  }
  console.log(`  + ${n} payslips (June PUBLISHED/paid, July DRAFT)`);
}

async function seedHolidays(adminId) {
  console.log('\n=== Holidays ===');
  const list = [
    { title: 'Republic Day', date: '2026-01-26', type: 'public' },
    { title: 'Holi', date: '2026-03-14', type: 'public' },
    { title: 'Independence Day', date: '2026-08-15', type: 'public' },
    { title: 'Diwali', date: '2026-11-08', type: 'public' },
    { title: 'Christmas', date: '2026-12-25', type: 'public' },
  ];
  let n = 0;
  for (const h of list) {
    const { data: exists } = await supabase.from('holidays').select('id').eq('date', h.date).maybeSingle();
    if (exists) continue;
    const { error } = await supabase.from('holidays').insert({ ...h, description: h.title, created_by: adminId });
    if (!error) n += 1;
  }
  console.log(`  + ${n} holidays`);
}

async function seedDocuments(employees, hrId) {
  console.log('\n=== Employee documents ===');
  let n = 0;
  for (const emp of employees) {
    if (emp.role === 'admin') continue;
    for (const docType of DOC_TYPES) {
      const { error } = await supabase.from('documents').insert({
        employee_id: emp.id,
        document_type: docType,
        document_name: `${docType.replace(/_/g, ' ')} - ${emp.first_name}`,
        document_url: `https://placehold.co/600x800/png?text=${encodeURIComponent(docType)}`,
        uploaded_by: hrId,
        is_verified: pick([true, false, false]),
      });
      if (!error) n += 1;
    }
  }
  console.log(`  + ${n} documents`);
}

async function seedAssets(employees) {
  console.log('\n=== Asset inventory + assignments ===');
  const pool = [
    { name: 'MacBook Pro 14"', category: 'Laptop', brand: 'Apple', model: 'M3 Pro', cost: 185000 },
    { name: 'ThinkPad X1 Carbon', category: 'Laptop', brand: 'Lenovo', model: 'Gen 11', cost: 125000 },
    { name: 'Dell UltraSharp 27"', category: 'Monitor', brand: 'Dell', model: 'U2723QE', cost: 52000 },
    { name: 'LG 24" Monitor', category: 'Monitor', brand: 'LG', model: '24MK600', cost: 14000 },
    { name: 'Sony WH-1000XM5', category: 'Headset', brand: 'Sony', model: 'XM5', cost: 28000 },
    { name: 'Jabra Evolve2', category: 'Headset', brand: 'Jabra', model: '65', cost: 22000 },
    { name: 'iPhone 15', category: 'Mobile Phone', brand: 'Apple', model: '128GB', cost: 79900 },
    { name: 'Samsung Galaxy S24', category: 'Mobile Phone', brand: 'Samsung', model: '256GB', cost: 74999 },
    { name: 'Logitech MX Keys', category: 'Keyboard', brand: 'Logitech', model: 'MX Keys', cost: 9995 },
    { name: 'Logitech MX Master 3S', category: 'Mouse', brand: 'Logitech', model: 'MX Master 3S', cost: 9995 },
  ];

  const staff = employees.filter((e) => e.role !== 'admin');
  let assigned = 0;
  let available = 0;

  for (let i = 0; i < pool.length; i++) {
    const item = pool[i];
    const assignee = i < staff.length ? staff[i] : null;
    const { error } = await supabase.from('assets').insert({
      name: item.name,
      category: item.category,
      brand: item.brand,
      model: item.model,
      serial_number: `SN-${rand(100000, 999999)}`,
      purchase_date: moment().subtract(rand(30, 800), 'days').format('YYYY-MM-DD'),
      purchase_cost: item.cost,
      warranty_expiry: moment().add(rand(180, 900), 'days').format('YYYY-MM-DD'),
      status: assignee ? 'assigned' : 'available',
      assigned_to: assignee?.id || null,
      assigned_on: assignee ? moment().subtract(rand(10, 200), 'days').format('YYYY-MM-DD') : null,
      location: 'HQ - Floor 3',
    });
    if (!error) {
      if (assignee) assigned += 1;
      else available += 1;
    }
  }
  console.log(`  + ${assigned} assigned assets, ${available} available in inventory`);
}

async function seedAssetRequests(employeeIds) {
  console.log('\n=== Asset requests (for approvals) ===');
  const reasons = [
    'Need laptop for client demos',
    'Current monitor flickering',
    'Headset mic not working on calls',
    'New joiner equipment',
    'Replacement after damage',
  ];
  let n = 0;
  let pending = 0;

  for (let i = 0; i < 18; i++) {
    const status = i < 10 ? 'requested' : pick(['approved', 'rejected']);
    const { error } = await supabase.from('asset_requests').insert({
      employee_id: pick(employeeIds),
      asset_type: pick(ASSET_TYPES),
      reason: pick(reasons),
      urgency: pick(['low', 'medium', 'high']),
      status,
      requested_on: moment().subtract(rand(0, 14), 'days').format('YYYY-MM-DD'),
    });
    if (!error) {
      n += 1;
      if (status === 'requested') pending += 1;
    }
  }
  console.log(`  + ${n} asset requests (${pending} pending for approvals)`);
}

async function seedReimbursements(employeeIds, managerIds, hrId) {
  console.log('\n=== Reimbursement claims ===');
  const descriptions = [
    'Client lunch meeting', 'Cab to airport', 'Team dinner', 'Medical bills',
    'Internet reimbursement', 'Office stationery', 'Conference travel',
  ];
  let n = 0;
  let pending = 0;

  for (let i = 0; i < 20; i++) {
    const status = i < 8 ? 'pending' : pick(['approved', 'approved', 'rejected']);
    const managerId = pick(managerIds);
    const row = {
      employee_id: pick(employeeIds),
      reimbursement_type: pick(REIMB_TYPES),
      amount: rand(500, 12000),
      description: pick(descriptions),
      expense_date: moment().subtract(rand(1, 45), 'days').format('YYYY-MM-DD'),
      status,
      receipt_url: 'https://placehold.co/400x600/png?text=Receipt',
    };
    if (status === 'approved') {
      row.manager_approved_by = managerId;
      row.manager_approved_at = moment().subtract(rand(1, 5), 'days').toISOString();
      row.approved_by = hrId;
      row.approval_date = moment().subtract(rand(0, 2), 'days').toISOString();
      row.payment_date = moment().format('YYYY-MM-DD');
    } else if (status === 'rejected') {
      row.rejection_reason = 'Receipt unclear / policy not met';
      row.manager_approved_by = managerId;
    }
    const { error } = await supabase.from('reimbursements').insert(row);
    if (!error) {
      n += 1;
      if (status === 'pending') pending += 1;
    }
  }
  console.log(`  + ${n} reimbursement claims (${pending} pending)`);
}

async function seedWfhRequests(employeeIds, managerIds) {
  console.log('\n=== WFH day requests ===');
  let n = 0;
  for (let i = 0; i < 10; i++) {
    const status = i < 5 ? 'pending' : pick(['approved', 'rejected']);
    const workDate = moment().add(rand(1, 14), 'days');
    while (workDate.day() === 0 || workDate.day() === 6) workDate.add(1, 'day');
    const row = {
      employee_id: pick(employeeIds),
      work_date: workDate.format('YYYY-MM-DD'),
      status,
      reason: pick(['Plumber visit', 'Doctor appointment', 'Home internet upgrade', 'Family commitment']),
    };
    if (status !== 'pending') {
      row.reviewed_by = pick(managerIds);
      row.reviewed_at = moment().subtract(rand(0, 3), 'days').toISOString();
      if (status === 'rejected') row.review_note = 'Team needs in-office presence that day';
    }
    const { error } = await supabase.from('wfh_day_requests').insert(row);
    if (!error) n += 1;
  }
  console.log(`  + ${n} WFH requests`);
}

async function seedHelpdesk(employeeIds, hrId) {
  console.log('\n=== Helpdesk tickets ===');
  const subjects = [
    'VPN not connecting', 'Payroll query', 'Leave balance mismatch',
    'Laptop slow performance', 'Email access issue', 'Payslip download error',
  ];
  let n = 0;
  for (let i = 0; i < 12; i++) {
    const status = pick(['open', 'open', 'in_progress', 'resolved']);
    const { data, error } = await supabase.from('helpdesk_tickets').insert({
      raised_by: pick(employeeIds),
      subject: pick(subjects),
      category: pick(['it', 'payroll', 'leave', 'benefits']),
      priority: pick(['low', 'medium', 'high']),
      status,
      description: 'Auto-seeded ticket for testing helpdesk workflows.',
      assigned_to: status === 'open' ? null : hrId,
      sla_due_by: moment().add(2, 'days').toISOString(),
      resolved_at: status === 'resolved' ? moment().toISOString() : null,
    }).select('id').single();
    if (!error && data?.id) {
      n += 1;
      await supabase.from('helpdesk_ticket_comments').insert({
        ticket_id: data.id,
        author_id: pick(employeeIds),
        text: 'Following up on this issue.',
      });
    }
  }
  console.log(`  + ${n} helpdesk tickets`);
}

async function seedPerformanceGoals(employeeIds) {
  console.log('\n=== Performance goals ===');
  const titles = [
    'Complete Q3 sales target', 'Ship feature X', 'Reduce bug backlog',
    'Improve NPS score', 'Mentor 2 juniors', 'Cut processing time 20%',
  ];
  let n = 0;
  for (const empId of employeeIds.slice(0, 15)) {
    const { error } = await supabase.from('performance_goals').insert({
      employee_id: empId,
      title: pick(titles),
      cycle: 'H1 2026',
      progress: rand(10, 90),
      status: pick(['on_track', 'at_risk', 'completed']),
      due_date: moment().add(rand(30, 120), 'days').format('YYYY-MM-DD'),
    });
    if (!error) n += 1;
  }
  console.log(`  + ${n} performance goals`);
}

async function main() {
  console.log('Reset + seed rich test data for HRMS...\n');

  await pruneExtras();

  const { data: admin } = await supabase.from('employees').select('id').eq('role', 'admin').limit(1).maybeSingle();
  const { data: hr } = await supabase.from('employees').select('id').eq('role', 'hr').limit(1).maybeSingle();
  const { data: neha } = await supabase.from('employees').select('id').ilike('email', 'neha.gupta%').maybeSingle();

  if (!admin?.id) {
    console.error('No System Admin found. Run: node scripts/seed-admin.js');
    process.exit(1);
  }

  const { all, byDeptManager } = await seedEmployees(neha?.id);
  const staffIds = all.filter((e) => e.role !== 'admin').map((e) => e.id);
  const employeeOnlyIds = all.filter((e) => e.role === 'employee').map((e) => e.id);
  const managerIds = [
    ...Object.values(byDeptManager),
    ...(neha?.id ? [neha.id] : []),
  ].filter(Boolean);

  await seedHolidays(admin.id);
  await seedLeaveBalances(staffIds);
  await seedAttendance(staffIds);
  await seedLeaves(employeeOnlyIds.length ? employeeOnlyIds : staffIds, managerIds, hr?.id || admin.id);
  await seedPayroll(all, admin.id);
  await seedDocuments(all, hr?.id || admin.id);
  await seedAssets(all);
  await seedAssetRequests(employeeOnlyIds.length ? employeeOnlyIds : staffIds);
  await seedReimbursements(employeeOnlyIds.length ? employeeOnlyIds : staffIds, managerIds, hr?.id || admin.id);
  await seedWfhRequests(employeeOnlyIds.length ? employeeOnlyIds : staffIds, managerIds);
  await seedHelpdesk(staffIds, hr?.id || admin.id);
  await seedPerformanceGoals(employeeOnlyIds.length ? employeeOnlyIds : staffIds);

  const { count: pendingLeaves } = await supabase.from('leaves').select('id', { count: 'exact', head: true }).eq('status', 'pending');
  const { count: pendingAssets } = await supabase.from('asset_requests').select('id', { count: 'exact', head: true }).eq('status', 'requested');

  console.log('\n✓ Test data ready\n');
  console.log(`Active people: ${all.length} (4 kept + 25 new)`);
  console.log(`Pending leave approvals: ${pendingLeaves ?? '?'}`);
  console.log(`Pending asset requests: ${pendingAssets ?? '?'}\n`);
  console.log('Login password pattern: FirstNameLastName@123\n');
  console.log('Core accounts:');
  console.log('  admin@company.com         / SystemAdmin@123');
  console.log('  hr1@company.com           / HROne@123');
  console.log('  neha.gupta@company.com    / NehaGupta@123');
  console.log('  deepak.chopra@company.com / DeepakChopra@123');
  console.log('\nSample new employees:');
  console.log('  vikram.singh@company.com  / VikramSingh@123  (Engineering Manager)');
  console.log('  arjun.mehta@company.com   / ArjunMehta@123');
  console.log('  aditya.nair@company.com   / AdityaNair@123');
  console.log('\nWhat to test:');
  console.log('  • Leave → Approvals (12+ pending)');
  console.log('  • Assets → Asset Requests (10+ pending)');
  console.log('  • Expense → Approvals (8+ pending reimbursements)');
  console.log('  • Attendance → Team Attendance');
  console.log('  • Payroll → My Payslips (June) + Run Payroll (July drafts)');
  console.log('  • Employees → profiles with documents');
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
