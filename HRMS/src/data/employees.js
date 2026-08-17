// ---------------------------------------------------------------------------
//  Employee master data. Everything else references these IDs.
// ---------------------------------------------------------------------------

const RAW = [
  // [first, last, gender, dept, designation, location, status, joinDate, mgr]
  ['Aarav', 'Mehta', 'male', 'Human Resources', 'Head of People', 'Bangalore HQ', 'active', '2019-03-04', null],
  ['Esther', 'Howard', 'female', 'Engineering', 'SDE Level 2', 'Bangalore HQ', 'active', '2024-09-12', 'EMP-0004'],
  ['Diya', 'Nair', 'female', 'Engineering', 'Engineering Manager', 'Bangalore HQ', 'active', '2020-07-01', 'EMP-0001'],
  ['Kabir', 'Rao', 'male', 'Engineering', 'Staff Engineer', 'Remote', 'active', '2021-01-18', 'EMP-0003'],
  ['Ananya', 'Iyer', 'female', 'Product', 'Product Manager', 'Bangalore HQ', 'active', '2022-04-11', 'EMP-0001'],
  ['Rohan', 'Gupta', 'male', 'Design', 'Lead Product Designer', 'Mumbai', 'active', '2021-11-02', 'EMP-0005'],
  ['Meera', 'Krishnan', 'female', 'Design', 'UX Designer', 'Mumbai', 'active', '2023-06-19', 'EMP-0006'],
  ['Vivaan', 'Sharma', 'male', 'Engineering', 'SDE Level 1', 'Bangalore HQ', 'probation', '2026-05-05', 'EMP-0003'],
  ['Isha', 'Kapoor', 'female', 'Marketing', 'Marketing Lead', 'Delhi NCR', 'active', '2020-09-14', 'EMP-0001'],
  ['Arjun', 'Reddy', 'male', 'Sales', 'Sales Manager', 'Hyderabad', 'active', '2019-12-01', 'EMP-0001'],
  ['Saanvi', 'Joshi', 'female', 'Sales', 'Account Executive', 'Hyderabad', 'active', '2023-02-27', 'EMP-0010'],
  ['Advait', 'Menon', 'male', 'Engineering', 'DevOps Engineer', 'Remote', 'active', '2022-08-08', 'EMP-0003'],
  ['Kiara', 'Bose', 'female', 'Finance', 'Finance Controller', 'Bangalore HQ', 'active', '2020-03-16', 'EMP-0001'],
  ['Reyansh', 'Malhotra', 'male', 'Finance', 'Payroll Specialist', 'Bangalore HQ', 'active', '2023-10-09', 'EMP-0013'],
  ['Anika', 'Desai', 'female', 'Human Resources', 'HR Business Partner', 'Bangalore HQ', 'active', '2021-05-24', 'EMP-0001'],
  ['Vihaan', 'Chopra', 'male', 'Product', 'Associate PM', 'Bangalore HQ', 'probation', '2026-06-01', 'EMP-0005'],
  ['Myra', 'Pillai', 'female', 'Customer Success', 'CS Manager', 'Remote', 'active', '2021-07-30', 'EMP-0001'],
  ['Aditya', 'Kulkarni', 'male', 'Customer Success', 'Support Specialist', 'Remote', 'active', '2024-01-15', 'EMP-0017'],
  ['Zara', 'Khan', 'female', 'Engineering', 'QA Engineer', 'Bangalore HQ', 'active', '2023-03-20', 'EMP-0003'],
  ['Ishaan', 'Verma', 'male', 'Operations', 'Operations Lead', 'Delhi NCR', 'active', '2020-11-11', 'EMP-0001'],
  ['Aisha', 'Sheikh', 'female', 'Marketing', 'Content Strategist', 'Delhi NCR', 'active', '2022-12-05', 'EMP-0009'],
  ['Kabir', 'Anand', 'male', 'Engineering', 'SDE Level 2', 'Remote', 'on-leave', '2022-02-14', 'EMP-0003'],
  ['Navya', 'Rao', 'female', 'Engineering', 'Frontend Engineer', 'Bangalore HQ', 'active', '2023-09-01', 'EMP-0003'],
  ['Dev', 'Patel', 'male', 'Sales', 'SDR', 'Hyderabad', 'active', '2024-04-22', 'EMP-0010'],
  ['Riya', 'Agarwal', 'female', 'Design', 'Visual Designer', 'Mumbai', 'active', '2024-07-08', 'EMP-0006'],
  ['Yash', 'Bhatt', 'male', 'Operations', 'Facilities Coordinator', 'Delhi NCR', 'active', '2023-05-30', 'EMP-0020'],
  ['Tara', 'Menon', 'female', 'Product', 'Product Analyst', 'Bangalore HQ', 'active', '2024-02-19', 'EMP-0005'],
  ['Neil', 'Fernandes', 'male', 'Engineering', 'Backend Engineer', 'Remote', 'resigned', '2021-08-17', 'EMP-0003'],
];

const SHIFTS = ['General (9:00 – 18:00)', 'Morning (7:00 – 16:00)', 'Evening (14:00 – 23:00)'];

// Salary tiers keyed by loose seniority found in designation.
function salaryFor(designation) {
  const d = designation.toLowerCase();
  let basic = 60000;
  if (/head|controller|manager|lead|staff/.test(d)) basic = 130000;
  else if (/level 2|senior|business partner|specialist|strategist|analyst|manager/.test(d)) basic = 85000;
  else if (/level 1|associate|sdr|coordinator|support/.test(d)) basic = 45000;
  const hra = Math.round(basic * 0.25);
  const da = Math.round(basic * 0.06);
  const pf = Math.round(basic * 0.12);
  const esic = basic <= 21000 ? Math.round(basic * 0.0075) : 0;
  return { basic, hra, da, special: Math.round(basic * 0.12), pf, esic };
}

function roleFor(designation) {
  const d = designation.toLowerCase();
  if (/head of people|hr business partner/.test(d)) return 'hr';
  if (/manager|lead|head|controller/.test(d)) return 'manager';
  return 'employee';
}

export const employees = RAW.map(([firstName, lastName, gender, department, designation, workLocation, status, joinDate, reportingTo], i) => {
  const id = `EMP-${String(i + 1).padStart(4, '0')}`;
  const handle = `${firstName}.${lastName}`.toLowerCase();
  const salary = salaryFor(designation);
  return {
    id,
    firstName,
    lastName,
    name: `${firstName} ${lastName}`,
    avatar: null,
    gender,
    dob: `19${85 + (i % 15)}-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 27) + 1).padStart(2, '0')}`,
    personalEmail: `${handle}@gmail.com`,
    workEmail: `${handle}@spaxads.com`,
    phone: `+91-9${String(800000000 + i * 111111).slice(0, 9)}`,
    designation,
    department,
    employmentType: /intern/.test(designation.toLowerCase()) ? 'intern' : 'full-time',
    status,
    role: id === 'EMP-0001' ? 'admin' : roleFor(designation),
    joinDate,
    reportingTo,
    workLocation,
    shift: SHIFTS[i % SHIFTS.length],
    address: `${12 + i} Residency Road, ${workLocation}`,
    emergencyContact: { name: `${lastName} Family`, phone: `+91-98${String(70000000 + i * 13).slice(0, 8)}`, relation: 'Parent' },
    bank: { name: 'HDFC Bank', account: `50100${String(1000000 + i * 7)}`, ifsc: 'HDFC0001234' },
    salary,
  };
});

export const employeeById = Object.fromEntries(employees.map((e) => [e.id, e]));

export function getEmployee(id) {
  return employeeById[id] || null;
}

export function getManagerName(id) {
  const e = employeeById[id];
  return e ? e.name : '—';
}

// Directory of just the reporting team for a given manager id.
export function getDirectReports(managerId) {
  return employees.filter((e) => e.reportingTo === managerId);
}
