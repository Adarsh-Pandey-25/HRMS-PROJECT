/**
 * Seed "My company" (admin 7imnoob7@gmail.com) with 20 staff for module testing.
 * Layout: 1 HR + 3 managers + 16 employees (reporting to managers).
 *
 * Run: node scripts/seed-my-company-test-data.js
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const moment = require('moment-timezone');
const { createClient } = require('@supabase/supabase-js');
const { generateDefaultPassword } = require('../src/utils/helpers');
const { TIMEZONE } = require('../src/utils/constants');
const { companyIdFields } = require('../src/utils/tenant');
const { allocateNextEmployeeCode } = require('../src/services/employeeCode.service');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const COMPANY_ID = 'd99f4785-5226-4f38-9b34-a59f92faf066';
const ADMIN_EMAIL = '7imnoob7@gmail.com';
const TZ = TIMEZONE || 'Asia/Kolkata';
const DOMAIN = 'mycompany.test';

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

/** 20 people: 1 HR, 3 managers, 16 employees */
const STAFF = [
  { email: `priya.hr@${DOMAIN}`, first_name: 'Priya', last_name: 'Mehta', role: 'hr', department: 'Human Resources', designation: 'HR Manager', salary: { basic: 70000, hra: 28000, da: 3000, special: 5000 } },

  { email: `arjun.eng@${DOMAIN}`, first_name: 'Arjun', last_name: 'Patel', role: 'manager', department: 'Engineering', designation: 'Engineering Manager', salary: { basic: 90000, hra: 36000, da: 4000, special: 8000 } },
  { email: `neha.sales@${DOMAIN}`, first_name: 'Neha', last_name: 'Sharma', role: 'manager', department: 'Sales', designation: 'Sales Manager', salary: { basic: 80000, hra: 32000, da: 3500, special: 6000 } },
  { email: `vikram.ops@${DOMAIN}`, first_name: 'Vikram', last_name: 'Singh', role: 'manager', department: 'Operations', designation: 'Ops Manager', salary: { basic: 75000, hra: 30000, da: 3200, special: 5500 } },

  // Engineering → Arjun
  { email: `rohan.dev@${DOMAIN}`, first_name: 'Rohan', last_name: 'Gupta', role: 'employee', department: 'Engineering', designation: 'Senior Developer', managerDept: 'Engineering', salary: { basic: 65000, hra: 26000, da: 2800, special: 4500 } },
  { email: `isha.fe@${DOMAIN}`, first_name: 'Isha', last_name: 'Verma', role: 'employee', department: 'Engineering', designation: 'Frontend Developer', managerDept: 'Engineering', salary: { basic: 52000, hra: 20800, da: 2200, special: 3500 } },
  { email: `kabir.be@${DOMAIN}`, first_name: 'Kabir', last_name: 'Khan', role: 'employee', department: 'Engineering', designation: 'Backend Developer', managerDept: 'Engineering', salary: { basic: 55000, hra: 22000, da: 2400, special: 4000 } },
  { email: `anki.qa@${DOMAIN}`, first_name: 'Anki', last_name: 'Jain', role: 'employee', department: 'Engineering', designation: 'QA Engineer', managerDept: 'Engineering', salary: { basic: 45000, hra: 18000, da: 2000, special: 3000 } },
  { email: `yash.devops@${DOMAIN}`, first_name: 'Yash', last_name: 'Bhatt', role: 'employee', department: 'Engineering', designation: 'DevOps Engineer', managerDept: 'Engineering', salary: { basic: 58000, hra: 23200, da: 2500, special: 4200 } },
  { email: `mehak.mobile@${DOMAIN}`, first_name: 'Mehak', last_name: 'Kaur', role: 'employee', department: 'Engineering', designation: 'Mobile Developer', managerDept: 'Engineering', salary: { basic: 54000, hra: 21600, da: 2300, special: 3800 } },

  // Sales → Neha
  { email: `raj.sales@${DOMAIN}`, first_name: 'Raj', last_name: 'Khanna', role: 'employee', department: 'Sales', designation: 'Sales Executive', managerDept: 'Sales', salary: { basic: 40000, hra: 16000, da: 1800, special: 2800 } },
  { email: `pooja.bd@${DOMAIN}`, first_name: 'Pooja', last_name: 'Nair', role: 'employee', department: 'Sales', designation: 'BD Executive', managerDept: 'Sales', salary: { basic: 38000, hra: 15200, da: 1600, special: 2500 } },
  { email: `amit.acct@${DOMAIN}`, first_name: 'Amit', last_name: 'Shah', role: 'employee', department: 'Sales', designation: 'Account Manager', managerDept: 'Sales', salary: { basic: 48000, hra: 19200, da: 2000, special: 3200 } },
  { email: `lara.mkt@${DOMAIN}`, first_name: 'Lara', last_name: 'Menon', role: 'employee', department: 'Marketing', designation: 'Content Lead', managerDept: 'Sales', salary: { basic: 44000, hra: 17600, da: 1900, special: 3000 } },
  { email: `ronit.social@${DOMAIN}`, first_name: 'Ronit', last_name: 'Das', role: 'employee', department: 'Marketing', designation: 'Social Media', managerDept: 'Sales', salary: { basic: 39000, hra: 15600, da: 1700, special: 2600 } },

  // Ops / Finance → Vikram
  { email: `om.payroll@${DOMAIN}`, first_name: 'Om', last_name: 'Prakash', role: 'employee', department: 'Finance', designation: 'Payroll Associate', managerDept: 'Operations', salary: { basic: 42000, hra: 16800, da: 1800, special: 2800 } },
  { email: `tina.ops@${DOMAIN}`, first_name: 'Tina', last_name: 'Roy', role: 'employee', department: 'Operations', designation: 'Ops Coordinator', managerDept: 'Operations', salary: { basic: 35000, hra: 14000, da: 1500, special: 2000 } },
  { email: `zara.admin@${DOMAIN}`, first_name: 'Zara', last_name: 'Ali', role: 'employee', department: 'Operations', designation: 'Office Admin', managerDept: 'Operations', salary: { basic: 32000, hra: 12800, da: 1400, special: 1800 } },
  { email: `dev.fin@${DOMAIN}`, first_name: 'Dev', last_name: 'Malhotra', role: 'employee', department: 'Finance', designation: 'Accountant', managerDept: 'Operations', salary: { basic: 50000, hra: 20000, da: 2200, special: 3400 } },
  { email: `sara.hrx@${DOMAIN}`, first_name: 'Sara', last_name: 'Joseph', role: 'employee', department: 'Human Resources', designation: 'HR Executive', managerDept: 'Operations', salary: { basic: 41000, hra: 16400, da: 1800, special: 2700 } },
];

const LEAVE_ALLOC = { CL: 12, SL: 12, EL: 15, WFH: 24 };

async function upsertEmployee(emp, managerId = null) {
  const { data: existing } = await supabase.from('employees').select('id').eq('email', emp.email).maybeSingle();
  const passwordHash = await bcrypt.hash(generateDefaultPassword(emp.first_name, emp.last_name), 10);
  const tenant = companyIdFields(COMPANY_ID, { attendance_mode: 'office' });

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
    console.log(`  ~ updated ${emp.role} ${emp.first_name} ${emp.last_name}`);
    return existing.id;
  }

  const employeeCode = await allocateNextEmployeeCode(COMPANY_ID);
  const { data, error } = await supabase.from('employees').insert({
    email: emp.email,
    first_name: emp.first_name,
    last_name: emp.last_name,
    role: emp.role,
    department: emp.department,
    designation: emp.designation,
    employee_code: employeeCode,
    password_hash: passwordHash,
    manager_id: emp.role === 'employee' ? managerId : null,
    date_of_joining: moment().tz(TZ).subtract(rand(14, 400), 'days').format('YYYY-MM-DD'),
    employment_type: 'full_time',
    gender: pick(['male', 'female']),
    phone: `9${rand(100000000, 999999999)}`,
    is_active: true,
    salary_details: emp.salary || { basic: 40000, hra: 16000, da: 2000, special: 3000 },
    ...tenant,
  }).select('id, employee_code').single();

  if (error) throw new Error(`${emp.email}: ${error.message}`);
  console.log(`  + ${emp.role.padEnd(8)} ${data.employee_code}  ${emp.first_name} ${emp.last_name} <${emp.email}>`);
  return data.id;
}

async function seedLeaveBalances(employeeIds) {
  console.log('\n=== Leave balances ===');
  const year = moment().tz(TZ).year();
  for (const employeeId of employeeIds) {
    for (const [leave_type, total] of Object.entries(LEAVE_ALLOC)) {
      const { data: ex } = await supabase
        .from('leave_balances')
        .select('id')
        .eq('employee_id', employeeId)
        .eq('leave_type', leave_type)
        .eq('year', year)
        .maybeSingle();
      if (ex) continue;
      const { error } = await supabase.from('leave_balances').insert({
        employee_id: employeeId,
        leave_type,
        year,
        total_allocated: total,
        used: 0,
        encashed: 0,
      });
      if (error && !/duplicate|unique/i.test(error.message)) {
        console.warn('  leave balance skip', leave_type, error.message);
      }
    }
  }
  console.log(`  balances for ${employeeIds.length} employees (${year})`);
}

async function seedAttendanceSample(employees) {
  console.log('\n=== Attendance sample (today check-in for ~half) ===');
  const todayStart = moment().tz(TZ).startOf('day');
  const staff = employees.filter((e) => e.role !== 'admin');
  let n = 0;
  for (const emp of staff.slice(0, Math.ceil(staff.length / 2))) {
    const checkIn = todayStart.clone().hour(9).minute(rand(0, 45)).second(0);
    const { data: existing } = await supabase
      .from('attendance')
      .select('id')
      .eq('employee_id', emp.id)
      .gte('check_in_time', todayStart.toISOString())
      .lte('check_in_time', todayStart.clone().endOf('day').toISOString())
      .maybeSingle();
    if (existing) continue;
    const { error } = await supabase.from('attendance').insert({
      employee_id: emp.id,
      check_in_time: checkIn.toISOString(),
      check_in_method: 'web',
      status: 'present',
    });
    if (!error) n += 1;
  }
  console.log(`  opened ${n} attendance sessions today`);
}

async function seedHolidayAndAnnouncement(adminId) {
  console.log('\n=== Holiday + announcement ===');
  const year = moment().tz(TZ).year();
  const holidayDate = moment().tz(TZ).add(20, 'days').format('YYYY-MM-DD');
  const { data: hEx } = await supabase
    .from('holidays')
    .select('id')
    .eq('company_id', COMPANY_ID)
    .eq('date', holidayDate)
    .maybeSingle();
  if (!hEx) {
    await supabase.from('holidays').insert({
      name: 'Company Foundation Day',
      date: holidayDate,
      type: 'company',
      is_optional: false,
      year,
      company_id: COMPANY_ID,
      created_by: adminId,
    });
    console.log('  + holiday', holidayDate);
  }

  const { data: aEx } = await supabase
    .from('announcements')
    .select('id')
    .eq('company_id', COMPANY_ID)
    .ilike('title', 'Welcome to My company%')
    .maybeSingle();
  if (!aEx) {
    await supabase.from('announcements').insert({
      title: 'Welcome to My company — test workspace',
      content: 'Seeded staff are ready. Test Attendance, Leave, Payroll, and Helpdesk modules.',
      priority: 'medium',
      audience: 'all',
      status: 'published',
      company_id: COMPANY_ID,
      created_by: adminId,
      published_at: new Date().toISOString(),
    });
    console.log('  + announcement');
  }
}

async function seedPendingLeave(employees) {
  console.log('\n=== Sample leave requests ===');
  const staff = employees.filter((e) => e.role === 'employee' && e.manager_id);
  let n = 0;
  for (const emp of staff.slice(0, 3)) {
    const from = moment().tz(TZ).add(rand(5, 15), 'days');
    const to = from.clone().add(1, 'day');
    const { error } = await supabase.from('leaves').insert({
      employee_id: emp.id,
      leave_type: 'CL',
      from_date: from.format('YYYY-MM-DD'),
      to_date: to.format('YYYY-MM-DD'),
      total_days: 2,
      reason: 'Personal work — seeded for approval testing',
      status: 'pending',
    });
    if (!error) n += 1;
  }
  console.log(`  ${n} pending leave(s)`);
}

async function main() {
  console.log('Seeding My company:', COMPANY_ID);

  const { data: admin, error: adminErr } = await supabase
    .from('employees')
    .select('id, email, company_id')
    .eq('email', ADMIN_EMAIL)
    .maybeSingle();
  if (adminErr || !admin) throw new Error(`Admin ${ADMIN_EMAIL} not found`);
  if (admin.company_id !== COMPANY_ID) throw new Error('Admin company mismatch');

  // Reset seq to match existing EMP max so codes stay EMP002+
  const { data: codes } = await supabase
    .from('employees')
    .select('employee_code')
    .eq('company_id', COMPANY_ID);
  let max = 0;
  for (const row of codes || []) {
    const m = /^EMP(\d+)$/i.exec(String(row.employee_code || ''));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  await supabase.from('companies').update({ employee_code_seq: max }).eq('id', COMPANY_ID);
  console.log(`employee_code_seq synced to ${max}`);

  console.log('\n=== Employees (20) ===');
  const byDeptManager = {};

  for (const emp of STAFF.filter((e) => e.role === 'manager' || e.role === 'hr')) {
    const id = await upsertEmployee(emp, null);
    if (emp.role === 'manager') byDeptManager[emp.department] = id;
  }

  for (const emp of STAFF) {
    if (emp.role === 'manager' || emp.role === 'hr') continue;
    const mgrId = byDeptManager[emp.managerDept] || byDeptManager.Engineering;
    await upsertEmployee(emp, mgrId);
  }

  const { data: all } = await supabase
    .from('employees')
    .select('id, role, first_name, last_name, email, department, manager_id, employee_code')
    .eq('company_id', COMPANY_ID)
    .eq('is_active', true)
    .order('employee_code');

  const ids = (all || []).map((e) => e.id);
  await seedLeaveBalances(ids);
  await seedAttendanceSample(all || []);
  await seedHolidayAndAnnouncement(admin.id);
  await seedPendingLeave(all || []);

  const counts = { admin: 0, hr: 0, manager: 0, employee: 0 };
  for (const e of all || []) counts[e.role] = (counts[e.role] || 0) + 1;

  console.log('\n=== Done ===');
  console.log('Headcount by role:', counts);
  console.log('Total active:', all?.length || 0);
  console.log('\nLogin passwords = {FirstName}{LastName}@123  e.g. PriyaMehta@123');
  console.log('Sample logins:');
  console.log('  HR:      priya.hr@mycompany.test / PriyaMehta@123');
  console.log('  Manager: arjun.eng@mycompany.test / ArjunPatel@123');
  console.log('  Staff:   rohan.dev@mycompany.test / RohanGupta@123');
  console.log('  Admin:   7imnoob7@gmail.com (your existing password)');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
