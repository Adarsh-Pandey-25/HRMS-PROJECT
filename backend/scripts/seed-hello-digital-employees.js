/**
 * Add 10 test employees to the Hello Digital company workspace.
 * Run: node scripts/seed-hello-digital-employees.js
 *
 * Login for all seeded staff: TestPass@123
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const moment = require('moment-timezone');
const { createClient } = require('@supabase/supabase-js');
const { companyIdFields } = require('../src/utils/tenant');
const { allocateNextEmployeeCode } = require('../src/services/employeeCode.service');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const TZ = process.env.TZ || 'Asia/Kolkata';
const PASSWORD = 'TestPass@123';
const DOMAIN = 'hellodigital.test';

const STAFF = [
  { email: `arjun.eng@${DOMAIN}`, first_name: 'Arjun', last_name: 'Patel', role: 'manager', department: 'Engineering', designation: 'Engineering Manager', salary: { basic: 90000, hra: 36000, da: 4000, special: 8000 } },
  { email: `isha.fe@${DOMAIN}`, first_name: 'Isha', last_name: 'Verma', role: 'employee', department: 'Engineering', designation: 'Frontend Developer', salary: { basic: 52000, hra: 20800, da: 2200, special: 3500 } },
  { email: `kabir.be@${DOMAIN}`, first_name: 'Kabir', last_name: 'Khan', role: 'employee', department: 'Engineering', designation: 'Backend Developer', salary: { basic: 55000, hra: 22000, da: 2400, special: 4000 } },
  { email: `meera.pd@${DOMAIN}`, first_name: 'Meera', last_name: 'Iyer', role: 'employee', department: 'Product', designation: 'Product Analyst', salary: { basic: 50000, hra: 20000, da: 2200, special: 3200 } },
  { email: `dev.design@${DOMAIN}`, first_name: 'Dev', last_name: 'Kapoor', role: 'employee', department: 'Design', designation: 'Product Designer', salary: { basic: 48000, hra: 19200, da: 2000, special: 3000 } },
  { email: `lara.mkt@${DOMAIN}`, first_name: 'Lara', last_name: 'Menon', role: 'employee', department: 'Marketing', designation: 'Content Lead', salary: { basic: 44000, hra: 17600, da: 1900, special: 3000 } },
  { email: `raj.sales@${DOMAIN}`, first_name: 'Raj', last_name: 'Khanna', role: 'employee', department: 'Sales', designation: 'Sales Executive', salary: { basic: 40000, hra: 16000, da: 1800, special: 2800 } },
  { email: `sara.hr@${DOMAIN}`, first_name: 'Sara', last_name: 'Joseph', role: 'employee', department: 'Human Resources', designation: 'HR Executive', salary: { basic: 41000, hra: 16400, da: 1800, special: 2700 } },
  { email: `om.fin@${DOMAIN}`, first_name: 'Om', last_name: 'Prakash', role: 'employee', department: 'Finance', designation: 'Accountant', salary: { basic: 50000, hra: 20000, da: 2200, special: 3400 } },
  { email: `tina.ops@${DOMAIN}`, first_name: 'Tina', last_name: 'Roy', role: 'employee', department: 'Operations', designation: 'Ops Coordinator', salary: { basic: 35000, hra: 14000, da: 1500, special: 2000 } },
];

const LEAVE_ALLOC = { CL: 12, SL: 12, EL: 15, WFH: 24 };
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

async function findCompany() {
  const { data, error } = await supabase.from('companies').select('id, name').order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  const match = (data || []).find((c) => /hello/i.test(c.name) && /digit/i.test(c.name))
    || (data || []).find((c) => /hello/i.test(c.name));
  if (!match) {
    throw new Error(`No Hello Digital company found. Companies: ${(data || []).map((c) => c.name).join(', ') || 'none'}`);
  }
  return match;
}

async function seedLeaveBalances(employeeId) {
  const year = moment().tz(TZ).year();
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

async function upsertEmployee(companyId, emp, managerId) {
  const { data: existing } = await supabase.from('employees').select('id').eq('email', emp.email).maybeSingle();
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const tenant = companyIdFields(companyId, { attendance_mode: 'office' });
  const payload = {
    first_name: emp.first_name,
    last_name: emp.last_name,
    role: emp.role,
    department: emp.department,
    designation: emp.designation,
    password_hash: passwordHash,
    manager_id: emp.role === 'employee' ? managerId : null,
    employment_type: 'full_time',
    gender: emp.first_name.match(/Isha|Meera|Lara|Sara|Tina/) ? 'female' : 'male',
    phone: `9${rand(100000000, 999999999)}`,
    is_active: true,
    salary_details: emp.salary,
    ...tenant,
  };

  if (existing) {
    const { error } = await supabase.from('employees').update(payload).eq('id', existing.id);
    if (error) throw new Error(`${emp.email}: ${error.message}`);
    console.log(`  ~ updated ${emp.role.padEnd(8)} ${emp.first_name} ${emp.last_name} <${emp.email}>`);
    await seedLeaveBalances(existing.id);
    return existing.id;
  }

  const employeeCode = await allocateNextEmployeeCode(companyId);
  const { data, error } = await supabase.from('employees').insert({
    email: emp.email,
    employee_code: employeeCode,
    date_of_joining: moment().tz(TZ).subtract(rand(20, 280), 'days').format('YYYY-MM-DD'),
    ...payload,
  }).select('id, employee_code').single();
  if (error) throw new Error(`${emp.email}: ${error.message}`);
  console.log(`  + ${emp.role.padEnd(8)} ${data.employee_code}  ${emp.first_name} ${emp.last_name} <${emp.email}>`);
  await seedLeaveBalances(data.id);
  return data.id;
}

async function main() {
  const company = await findCompany();
  console.log(`Seeding 10 employees into ${company.name} (${company.id})\n`);

  const manager = STAFF.find((s) => s.role === 'manager');
  const managerId = await upsertEmployee(company.id, manager, null);
  for (const emp of STAFF.filter((s) => s.role !== 'manager')) {
    await upsertEmployee(company.id, emp, managerId);
  }

  console.log('\nAll 10 can sign in with password: TestPass@123');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
