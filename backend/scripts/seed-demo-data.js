/**
 * Seed demo data across all HRMS modules (~25 employees + related records).
 * Run: node scripts/seed-demo-data.js
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const moment = require('moment-timezone');
const { createClient } = require('@supabase/supabase-js');
const { generateDefaultPassword } = require('../src/utils/helpers');
const { TIMEZONE } = require('../src/utils/constants');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const YEAR = 2026;

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

const DEMO_EMPLOYEES = [
  { email: 'vikram.singh@company.com', first_name: 'Vikram', last_name: 'Singh', role: 'manager', department: 'Engineering', designation: 'Engineering Manager', salary: { basic: 85000, hra: 34000 } },
  { email: 'neha.gupta@company.com', first_name: 'Neha', last_name: 'Gupta', role: 'manager', department: 'Sales', designation: 'Sales Manager', salary: { basic: 78000, hra: 31200 } },
  { email: 'arjun.mehta@company.com', first_name: 'Arjun', last_name: 'Mehta', role: 'employee', department: 'Engineering', designation: 'Senior Developer', salary: { basic: 65000, hra: 26000 } },
  { email: 'kavya.iyer@company.com', first_name: 'Kavya', last_name: 'Iyer', role: 'employee', department: 'Engineering', designation: 'Frontend Developer', salary: { basic: 55000, hra: 22000 } },
  { email: 'rohan.desai@company.com', first_name: 'Rohan', last_name: 'Desai', role: 'employee', department: 'Engineering', designation: 'Backend Developer', salary: { basic: 58000, hra: 23200 } },
  { email: 'simran.kaur@company.com', first_name: 'Simran', last_name: 'Kaur', role: 'employee', department: 'Engineering', designation: 'QA Engineer', salary: { basic: 48000, hra: 19200 } },
  { email: 'aditya.nair@company.com', first_name: 'Aditya', last_name: 'Nair', role: 'employee', department: 'Sales', designation: 'Sales Executive', salary: { basic: 42000, hra: 16800 } },
  { email: 'priya.reddy@company.com', first_name: 'Priya', last_name: 'Reddy', role: 'employee', department: 'Sales', designation: 'Account Manager', salary: { basic: 50000, hra: 20000 } },
  { email: 'karthik.menon@company.com', first_name: 'Karthik', last_name: 'Menon', role: 'employee', department: 'Marketing', designation: 'Marketing Specialist', salary: { basic: 45000, hra: 18000 } },
  { email: 'divya.pillai@company.com', first_name: 'Divya', last_name: 'Pillai', role: 'employee', department: 'Marketing', designation: 'Content Writer', salary: { basic: 40000, hra: 16000 } },
  { email: 'suresh.kumar@company.com', first_name: 'Suresh', last_name: 'Kumar', role: 'employee', department: 'Finance', designation: 'Accountant', salary: { basic: 52000, hra: 20800 } },
  { email: 'anita.joshi@company.com', first_name: 'Anita', last_name: 'Joshi', role: 'employee', department: 'HR', designation: 'HR Associate', salary: { basic: 46000, hra: 18400 } },
  { email: 'manish.agarwal@company.com', first_name: 'Manish', last_name: 'Agarwal', role: 'employee', department: 'Operations', designation: 'Operations Analyst', salary: { basic: 44000, hra: 17600 } },
  { email: 'pooja.bansal@company.com', first_name: 'Pooja', last_name: 'Bansal', role: 'employee', department: 'Engineering', designation: 'DevOps Engineer', salary: { basic: 62000, hra: 24800 } },
  { email: 'deepak.chopra@company.com', first_name: 'Deepak', last_name: 'Chopra', role: 'employee', department: 'Sales', designation: 'Business Development', salary: { basic: 47000, hra: 18800 } },
];

const HOLIDAYS = [
  { title: 'Republic Day', date: '2026-01-26', type: 'public', description: 'National holiday' },
  { title: 'Holi', date: '2026-03-14', type: 'public', description: 'Festival of colors' },
  { title: 'Good Friday', date: '2026-04-03', type: 'public', description: 'Christian holiday' },
  { title: 'Independence Day', date: '2026-08-15', type: 'public', description: 'National holiday' },
  { title: 'Gandhi Jayanti', date: '2026-10-02', type: 'public', description: 'Birth anniversary of Mahatma Gandhi' },
  { title: 'Diwali', date: '2026-11-08', type: 'public', description: 'Festival of lights' },
  { title: 'Christmas', date: '2026-12-25', type: 'public', description: 'Christmas Day' },
  { title: 'Company Foundation Day', date: '2026-06-15', type: 'optional', description: 'Optional company holiday' },
];

const ANNOUNCEMENTS = [
  { title: 'Welcome to Q3 2026', content: 'Let us aim for strong delivery and teamwork this quarter. All hands meeting on Friday at 4 PM.', priority: 'high', target_audience: 'all' },
  { title: 'Updated Leave Policy', content: 'Please review the updated leave policy document on the HR portal. WFH requests need manager approval.', priority: 'medium', target_audience: 'employees' },
  { title: 'Security Awareness Training', content: 'Mandatory cybersecurity training must be completed by end of this month.', priority: 'urgent', target_audience: 'all' },
  { title: 'Manager Sync', content: 'Monthly manager sync call scheduled for every first Monday at 11 AM IST.', priority: 'medium', target_audience: 'managers' },
  { title: 'Festival Bonus Announcement', content: 'Festival bonus will be credited along with July payroll for eligible employees.', priority: 'high', target_audience: 'employees' },
];

const TRAININGS = [
  { title: 'React Advanced Patterns', description: 'Deep dive into hooks, performance, and state management.', training_mode: 'online', start_date: '2026-07-01', end_date: '2026-07-15', duration_hours: 12, status: 'ongoing' },
  { title: 'Workplace Ethics', description: 'Company code of conduct and compliance training.', training_mode: 'online', start_date: '2026-06-20', end_date: '2026-06-30', duration_hours: 4, status: 'completed' },
  { title: 'Leadership Skills', description: 'Management fundamentals for team leads.', training_mode: 'hybrid', start_date: '2026-08-01', end_date: '2026-08-10', duration_hours: 16, status: 'scheduled' },
  { title: 'Data Security Basics', description: 'Protecting company and customer data.', training_mode: 'online', start_date: '2026-07-05', end_date: '2026-07-12', duration_hours: 6, status: 'ongoing' },
];

async function upsertEmployee(emp, managerId = null) {
  const { data: existing } = await supabase.from('employees').select('id').eq('email', emp.email).single();
  if (existing) return existing.id;

  const passwordHash = await bcrypt.hash(generateDefaultPassword(emp.first_name, emp.last_name), 10);
  const code = `EMP${rand(20000, 99999)}`;

  const { data, error } = await supabase
    .from('employees')
    .insert({
      email: emp.email,
      first_name: emp.first_name,
      last_name: emp.last_name,
      role: emp.role,
      department: emp.department,
      designation: emp.designation,
      employee_code: code,
      password_hash: passwordHash,
      manager_id: emp.role === 'employee' ? managerId : null,
      date_of_joining: moment().tz(TIMEZONE).subtract(rand(30, 800), 'days').format('YYYY-MM-DD'),
      employment_type: 'full_time',
      is_active: true,
      salary_details: emp.salary || { basic: 45000, hra: 18000 },
    })
    .select('id')
    .single();

  if (error) throw new Error(`Employee ${emp.email}: ${error.message}`);
  console.log(`  + Employee: ${emp.first_name} ${emp.last_name} (${emp.email})`);
  return data.id;
}

async function seedEmployees() {
  console.log('\n--- Employees ---');
  const { data: existingManagers } = await supabase
    .from('employees')
    .select('id, department')
    .eq('role', 'manager')
    .eq('is_active', true);

  const managers = existingManagers || [];
  const newManagerIds = [];

  for (const emp of DEMO_EMPLOYEES) {
    const id = await upsertEmployee(emp, null);
    if (emp.role === 'manager') newManagerIds.push({ id, department: emp.department });
  }

  const allManagers = [...managers, ...newManagerIds];
  const engManager = allManagers.find((m) => m.department === 'Engineering') || allManagers[0];
  const salesManager = allManagers.find((m) => m.department === 'Sales') || allManagers[0];

  const { data: employeesWithoutManager } = await supabase
    .from('employees')
    .select('id, department')
    .eq('role', 'employee')
    .eq('is_active', true)
    .is('manager_id', null);

  for (const emp of employeesWithoutManager || []) {
    const mgr = emp.department === 'Sales' ? salesManager : engManager;
    if (mgr) {
      await supabase.from('employees').update({ manager_id: mgr.id }).eq('id', emp.id);
    }
  }

  const { data: allEmployees } = await supabase
    .from('employees')
    .select('id, role, first_name, last_name, salary_details')
    .eq('is_active', true);

  return { allEmployees: allEmployees || [], managers: allManagers };
}

async function seedHolidays(adminId) {
  console.log('\n--- Holidays ---');
  for (const h of HOLIDAYS) {
    const { data: exists } = await supabase.from('holidays').select('id').eq('date', h.date).eq('title', h.title).single();
    if (exists) continue;
    const { error } = await supabase.from('holidays').insert({ ...h, created_by: adminId });
    if (error) console.error('  Holiday error:', error.message);
    else console.log(`  + ${h.title}`);
  }
}

async function seedAnnouncements(adminId) {
  console.log('\n--- Announcements ---');
  for (const a of ANNOUNCEMENTS) {
    const { data: exists } = await supabase.from('announcements').select('id').eq('title', a.title).single();
    if (exists) continue;
    const { error } = await supabase.from('announcements').insert({
      ...a,
      published_by: adminId,
      is_active: true,
      expires_at: moment().tz(TIMEZONE).add(90, 'days').toISOString(),
    });
    if (error) console.error('  Announcement error:', error.message);
    else console.log(`  + ${a.title}`);
  }
}

async function seedTrainings(adminId, employeeIds) {
  console.log('\n--- Trainings ---');
  const trainingIds = [];
  for (const t of TRAININGS) {
    const { data: exists } = await supabase.from('trainings').select('id').eq('title', t.title).single();
    if (exists) {
      trainingIds.push(exists.id);
      continue;
    }
    const { data, error } = await supabase.from('trainings').insert({ ...t, created_by: adminId }).select('id').single();
    if (error) {
      console.error('  Training error:', error.message);
      continue;
    }
    trainingIds.push(data.id);
    console.log(`  + ${t.title}`);
  }

  const statuses = ['assigned', 'in_progress', 'completed'];
  for (const trainingId of trainingIds) {
    const assignees = employeeIds.sort(() => 0.5 - Math.random()).slice(0, rand(4, 8));
    for (const empId of assignees) {
      await supabase.from('employee_trainings').upsert({
        training_id: trainingId,
        employee_id: empId,
        assigned_by: adminId,
        status: pick(statuses),
        completion_date: pick(statuses) === 'completed' ? moment().subtract(rand(1, 10), 'days').toISOString() : null,
        rating: pick(statuses) === 'completed' ? rand(3, 5) : null,
      }, { onConflict: 'training_id,employee_id' });
    }
  }
}

async function seedAttendance(employeeIds) {
  console.log('\n--- Attendance ---');
  const statuses = ['present', 'present', 'present', 'late', 'half_day', 'early_departure'];
  let count = 0;

  for (const empId of employeeIds) {
    for (let d = 14; d >= 1; d--) {
      const day = moment().tz(TIMEZONE).subtract(d, 'days');
      if (day.day() === 0 || day.day() === 6) continue;

      const dayStart = day.clone().hour(9).minute(rand(0, 45));
      const hours = pick([7.5, 8, 8.5, 9, 9.5]);
      const checkOut = dayStart.clone().add(hours, 'hours');
      const status = pick(statuses);

      const { data: exists } = await supabase
        .from('attendance')
        .select('id')
        .eq('employee_id', empId)
        .gte('check_in_time', day.format('YYYY-MM-DD'))
        .lt('check_in_time', day.clone().add(1, 'day').format('YYYY-MM-DD'))
        .limit(1);

      if (exists?.length) continue;

      const { error } = await supabase.from('attendance').insert({
        employee_id: empId,
        check_in_time: dayStart.toISOString(),
        check_out_time: checkOut.toISOString(),
        check_in_method: 'web',
        check_out_method: 'web',
        total_hours: hours,
        status,
        break_minutes: rand(0, 30),
      });
      if (!error) count += 1;
    }
  }
  console.log(`  + ${count} attendance records`);
}

async function seedLeaves(employeeIds, managerIds, hrId) {
  console.log('\n--- Leaves ---');
  const types = ['CL', 'SL', 'EL', 'WFH'];
  const statuses = ['pending', 'approved', 'approved', 'rejected'];
  let count = 0;

  for (let i = 0; i < 22; i++) {
    const empId = pick(employeeIds);
    const from = moment().tz(TIMEZONE).add(rand(-30, 20), 'days');
    const days = pick([1, 1, 2, 3]);
    const to = from.clone().add(days - 1, 'days');
    const status = pick(statuses);
    const managerId = pick(managerIds);
    const isHalf = pick([false, false, true]);

    const row = {
      employee_id: empId,
      leave_type: pick(types),
      from_date: from.format('YYYY-MM-DD'),
      to_date: to.format('YYYY-MM-DD'),
      total_days: isHalf ? 0.5 : days,
      is_half_day: isHalf,
      reason: pick(['Family function', 'Medical appointment', 'Personal work', 'Vacation', 'WFH - home repair', 'Not feeling well']),
      status,
    };

    if (status === 'approved') {
      row.manager_approved_by = managerId;
      row.manager_approved_at = moment().subtract(rand(1, 5), 'days').toISOString();
      row.approved_by = hrId;
      row.approved_at = moment().subtract(rand(0, 2), 'days').toISOString();
    } else if (status === 'rejected') {
      row.rejection_reason = 'Insufficient staffing during requested period';
    }

    const { error } = await supabase.from('leaves').insert(row);
    if (!error) count += 1;
  }
  console.log(`  + ${count} leave requests`);
}

async function seedReimbursements(employeeIds, managerIds, hrId) {
  console.log('\n--- Reimbursements ---');
  const types = ['travel', 'food', 'medical', 'internet_phone', 'office_supplies', 'other'];
  const statuses = ['pending', 'approved', 'approved', 'rejected', 'paid'];
  let count = 0;

  for (let i = 0; i < 20; i++) {
    const empId = pick(employeeIds);
    const status = pick(statuses);
    const managerId = pick(managerIds);
    const row = {
      employee_id: empId,
      reimbursement_type: pick(types),
      amount: rand(500, 15000),
      description: pick(['Client visit travel', 'Team lunch', 'Internet bill', 'Cab to office', 'Medical reimbursement', 'Office stationery', 'Conference registration']),
      expense_date: moment().tz(TIMEZONE).subtract(rand(1, 45), 'days').format('YYYY-MM-DD'),
      status,
    };

    if (['approved', 'paid'].includes(status)) {
      row.manager_approved_by = managerId;
      row.manager_approved_at = moment().subtract(rand(3, 10), 'days').toISOString();
      row.approved_by = hrId;
      row.approval_date = moment().subtract(rand(1, 5), 'days').toISOString();
    }
    if (status === 'rejected') row.rejection_reason = 'Receipt not valid';
    if (status === 'paid') row.payment_date = moment().subtract(rand(0, 3), 'days').format('YYYY-MM-DD');

    const { error } = await supabase.from('reimbursements').insert(row);
    if (!error) count += 1;
  }
  console.log(`  + ${count} reimbursement claims`);
}

async function seedPayroll(employees) {
  console.log('\n--- Payroll ---');
  const months = [
    { month: 6, year: YEAR },
    { month: 7, year: YEAR },
  ];
  let count = 0;

  for (const emp of employees) {
    if (!['employee', 'manager', 'hr'].includes(emp.role)) continue;
    const salary = emp.salary_details || { basic: 45000, hra: 18000 };
    const basic = parseFloat(salary.basic || 45000);
    const hra = parseFloat(salary.hra || basic * 0.4);
    const gross = basic + hra + 5000;
    const deductions = basic * 0.12 + 200;
    const net = gross - deductions;

    for (const { month, year } of months) {
      const { data: exists } = await supabase
        .from('payroll')
        .select('id')
        .eq('employee_id', emp.id)
        .eq('month', month)
        .eq('year', year)
        .single();

      if (exists) continue;

      const { error } = await supabase.from('payroll').insert({
        employee_id: emp.id,
        month,
        year,
        basic_salary: basic,
        hra,
        special_allowance: 3000,
        transport_allowance: 1500,
        medical_allowance: 500,
        gross_salary: gross,
        pf_deduction: basic * 0.12,
        professional_tax: 200,
        total_deductions: deductions,
        net_salary: net,
        payment_status: month < 7 ? 'paid' : 'processed',
        payment_date: month < 7 ? `${year}-${String(month).padStart(2, '0')}-28` : null,
      });
      if (!error) count += 1;
    }
  }
  console.log(`  + ${count} payslip records`);
}

async function seedDocuments(employeeIds, adminId) {
  console.log('\n--- Documents ---');
  const docTypes = ['aadhar', 'pan', 'offer_letter', 'educational_certificate', 'experience_letter'];
  let count = 0;

  for (const empId of employeeIds.slice(0, 15)) {
    for (let i = 0; i < rand(1, 3); i++) {
      const type = pick(docTypes);
      const { error } = await supabase.from('documents').insert({
        employee_id: empId,
        document_type: type,
        document_name: `${type.replace('_', ' ')}.pdf`,
        document_url: `demo/${empId}/${type}.pdf`,
        uploaded_by: adminId,
        is_verified: Math.random() > 0.5,
      });
      if (!error) count += 1;
    }
  }
  console.log(`  + ${count} documents`);
}

async function ensureSalaries() {
  const { data: emps } = await supabase.from('employees').select('id, salary_details').eq('is_active', true);
  for (const emp of emps || []) {
    if (!emp.salary_details || !emp.salary_details.basic) {
      await supabase.from('employees').update({
        salary_details: { basic: rand(40000, 70000), hra: rand(16000, 28000) },
      }).eq('id', emp.id);
    }
  }
}

async function main() {
  console.log('Seeding HRMS demo data...\n');

  const { data: admin } = await supabase.from('employees').select('id').eq('role', 'admin').limit(1).single();
  const { data: hr } = await supabase.from('employees').select('id').eq('role', 'hr').limit(1).single();
  const adminId = admin?.id;
  const hrId = hr?.id || adminId;

  if (!adminId) {
    console.error('No admin found. Run: node scripts/seed-admin.js');
    process.exit(1);
  }

  await ensureSalaries();
  const { allEmployees, managers } = await seedEmployees();
  const employeeIds = allEmployees.filter((e) => e.role === 'employee').map((e) => e.id);
  const managerIds = managers.map((m) => m.id);

  await seedHolidays(adminId);
  await seedAnnouncements(adminId);
  await seedTrainings(adminId, employeeIds);
  await seedAttendance(employeeIds);
  await seedLeaves(employeeIds, managerIds, hrId);
  await seedReimbursements(employeeIds, managerIds, hrId);
  await seedPayroll(allEmployees);
  await seedDocuments(employeeIds, adminId);

  console.log('\n✓ Demo data seeding complete!');
  console.log(`  Employees: ${allEmployees.length}`);
  console.log(`  Password format: FirstNameLastName@123 (e.g. VikramSingh@123)`);
  console.log('\nSample logins:');
  console.log('  admin@company.com / SystemAdmin@123');
  console.log('  vikram.singh@company.com / VikramSingh@123');
  console.log('  arjun.mehta@company.com / ArjunMehta@123');
}

main().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
