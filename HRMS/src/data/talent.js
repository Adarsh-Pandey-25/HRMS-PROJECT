// ---------------------------------------------------------------------------
//  Recruitment
// ---------------------------------------------------------------------------
export const jobs = [
  { id: 'JOB-001', title: 'Senior React Developer', department: 'Engineering', location: 'Bangalore / Remote', type: 'full-time', experience: { min: 4, max: 7 }, skills: ['React', 'TypeScript', 'Node.js'], salaryRange: { min: 1200000, max: 1800000 }, status: 'active', postedOn: '2026-06-15', applicantCount: 34 },
  { id: 'JOB-002', title: 'Product Designer', department: 'Design', location: 'Mumbai', type: 'full-time', experience: { min: 3, max: 6 }, skills: ['Figma', 'Design Systems', 'Prototyping'], salaryRange: { min: 1000000, max: 1500000 }, status: 'active', postedOn: '2026-06-22', applicantCount: 21 },
  { id: 'JOB-003', title: 'DevOps Engineer', department: 'Engineering', location: 'Remote', type: 'full-time', experience: { min: 3, max: 8 }, skills: ['AWS', 'Kubernetes', 'Terraform'], salaryRange: { min: 1400000, max: 2000000 }, status: 'active', postedOn: '2026-07-01', applicantCount: 12 },
  { id: 'JOB-004', title: 'Account Executive', department: 'Sales', location: 'Hyderabad', type: 'full-time', experience: { min: 2, max: 5 }, skills: ['SaaS Sales', 'Negotiation', 'CRM'], salaryRange: { min: 800000, max: 1200000 }, status: 'active', postedOn: '2026-06-28', applicantCount: 18 },
  { id: 'JOB-005', title: 'HR Intern', department: 'Human Resources', location: 'Bangalore HQ', type: 'intern', experience: { min: 0, max: 1 }, skills: ['Communication', 'MS Office'], salaryRange: { min: 300000, max: 400000 }, status: 'paused', postedOn: '2026-05-30', applicantCount: 47 },
  { id: 'JOB-006', title: 'Marketing Manager', department: 'Marketing', location: 'Delhi NCR', type: 'full-time', experience: { min: 5, max: 9 }, skills: ['Growth', 'SEO', 'Brand'], salaryRange: { min: 1500000, max: 2200000 }, status: 'closed', postedOn: '2026-04-10', applicantCount: 63 },
];

const CANDIDATE_NAMES = [
  ['Rahul Mehta', 'LinkedIn'], ['Priya Sharma', 'Referral'], ['Karan Singh', 'Portal'],
  ['Sneha Patil', 'LinkedIn'], ['Amit Kumar', 'Referral'], ['Neha Gupta', 'Portal'],
  ['Rohit Verma', 'LinkedIn'], ['Divya Rao', 'Naukri'], ['Sameer Khan', 'Referral'],
  ['Pooja Nair', 'LinkedIn'], ['Vikram Joshi', 'Portal'], ['Anjali Desai', 'LinkedIn'],
  ['Nikhil Reddy', 'Referral'], ['Shreya Iyer', 'Portal'], ['Manish Agarwal', 'Naukri'],
  ['Kavya Menon', 'LinkedIn'], ['Rajat Bose', 'Referral'], ['Tanvi Shah', 'Portal'],
];

const STAGES = ['applied', 'screening', 'interview', 'technical', 'hr-round', 'offer', 'hired', 'rejected'];

export const candidates = CANDIDATE_NAMES.map(([name, source], i) => {
  const stage = STAGES[i % STAGES.length];
  const jobId = jobs[i % 4].id;
  return {
    id: `CND-${String(i + 1).padStart(3, '0')}`,
    jobId,
    name,
    email: `${name.split(' ')[0].toLowerCase()}@gmail.com`,
    phone: `+91-9${String(700000000 + i * 234567).slice(0, 9)}`,
    source,
    resumeUrl: null,
    stage,
    rating: (i % 5) + 1,
    daysInStage: (i % 6) + 1,
    appliedOn: `2026-06-${String(15 + (i % 14)).padStart(2, '0')}`,
    experience: (i % 8) + 2,
  };
});

export const KANBAN_STAGES = [
  { id: 'applied', label: 'Applied' },
  { id: 'screening', label: 'Screening' },
  { id: 'interview', label: 'Interview' },
  { id: 'technical', label: 'Technical' },
  { id: 'hr-round', label: 'HR Round' },
  { id: 'offer', label: 'Offer' },
  { id: 'hired', label: 'Hired' },
];

export const interviews = [
  { id: 'INT-01', candidateId: 'CND-003', candidate: 'Karan Singh', role: 'Senior React Developer', interviewer: 'Diya Nair', mode: 'video', date: '2026-07-08', time: '11:00' },
  { id: 'INT-02', candidateId: 'CND-004', candidate: 'Sneha Patil', role: 'Product Designer', interviewer: 'Rohan Gupta', mode: 'in-person', date: '2026-07-08', time: '15:30' },
  { id: 'INT-03', candidateId: 'CND-007', candidate: 'Rohit Verma', role: 'Senior React Developer', interviewer: 'Kabir Rao', mode: 'video', date: '2026-07-09', time: '10:00' },
  { id: 'INT-04', candidateId: 'CND-011', candidate: 'Vikram Joshi', role: 'DevOps Engineer', interviewer: 'Advait Menon', mode: 'video', date: '2026-07-10', time: '14:00' },
];

// ---------------------------------------------------------------------------
//  Performance
// ---------------------------------------------------------------------------
export const goals = [
  { id: 'GOAL-001', employeeId: 'EMP-0001', title: 'Roll out new hiring pipeline org-wide', category: 'company', targetValue: 100, currentValue: 70, unit: '%', dueDate: '2026-09-30', status: 'in-progress' },
  { id: 'GOAL-002', employeeId: 'EMP-0001', title: 'Reduce time-to-hire to under 25 days', category: 'team', targetValue: 25, currentValue: 31, unit: 'days', dueDate: '2026-08-31', status: 'in-progress' },
  { id: 'GOAL-003', employeeId: 'EMP-0001', title: 'Launch employee wellness program', category: 'individual', targetValue: 100, currentValue: 100, unit: '%', dueDate: '2026-06-30', status: 'completed' },
  { id: 'GOAL-004', employeeId: 'EMP-0001', title: 'Achieve 90% engagement survey participation', category: 'company', targetValue: 90, currentValue: 45, unit: '%', dueDate: '2026-10-15', status: 'in-progress' },
];

export const reviewCycles = [
  { id: 'CYCLE-2026-H1', name: 'H1 2026 Review', period: 'Jan – Jun 2026', type: 'half-yearly', participants: 26, submitted: 18, selfDeadline: '2026-07-15', managerDeadline: '2026-07-25', publishDate: '2026-08-01', status: 'active' },
  { id: 'CYCLE-2025-H2', name: 'H2 2025 Review', period: 'Jul – Dec 2025', type: 'half-yearly', participants: 24, submitted: 24, selfDeadline: '2026-01-15', managerDeadline: '2026-01-25', publishDate: '2026-02-01', status: 'completed' },
];

export const myReview = {
  id: 'REV-001',
  cycleId: 'CYCLE-2026-H1',
  employeeId: 'EMP-0001',
  selfRating: 4.2,
  managerRating: null,
  finalRating: null,
  selfComments: 'Led the People function through a strong first half with successful wellness and hiring initiatives.',
  managerComments: '',
  competencies: [
    { name: 'Leadership', selfScore: 5, managerScore: null },
    { name: 'Communication', selfScore: 4, managerScore: null },
    { name: 'Execution', selfScore: 4, managerScore: null },
    { name: 'Strategic Thinking', selfScore: 4, managerScore: null },
    { name: 'Collaboration', selfScore: 5, managerScore: null },
  ],
  status: 'self-submitted',
};

export const teamReviews = [
  { employeeId: 'EMP-0002', goalsCompleted: 3, goalsTotal: 4, selfRating: 4.0, managerRating: 3.8, status: 'in-review' },
  { employeeId: 'EMP-0004', goalsCompleted: 5, goalsTotal: 5, selfRating: 4.6, managerRating: 4.5, status: 'completed' },
  { employeeId: 'EMP-0015', goalsCompleted: 4, goalsTotal: 6, selfRating: 3.9, managerRating: null, status: 'pending' },
  { employeeId: 'EMP-0023', goalsCompleted: 3, goalsTotal: 3, selfRating: 4.2, managerRating: null, status: 'pending' },
];

// ---------------------------------------------------------------------------
//  Training
// ---------------------------------------------------------------------------
export const courses = [
  { id: 'TRN-001', title: 'React Advanced Patterns', description: '<p>Deep dive into hooks, suspense and performance patterns.</p>', category: 'Technical', departmentAccess: ['Engineering'], format: 'video', duration: '2h 15m', isMandatory: false, isNewJoinerCourse: false, newJoinerOrder: null, videoUrl: 'https://vimeo.com/trn-001', thumbnailUrl: null, status: 'active', createdBy: 'EMP-0001', createdAt: '2026-01-15T10:00:00Z' },
  { id: 'TRN-002', title: 'Financial Modeling Basics', description: '<p>Build robust 3-statement models in Excel.</p>', category: 'Finance', departmentAccess: ['Finance'], format: 'document', duration: '1h 30m', isMandatory: false, isNewJoinerCourse: false, newJoinerOrder: null, videoUrl: null, thumbnailUrl: null, status: 'active', createdBy: 'EMP-0001', createdAt: '2026-02-01T10:00:00Z' },
  { id: 'TRN-003', title: 'Effective Leadership', description: '<p>Core people-management skills for every manager.</p>', category: 'HR', departmentAccess: ['all'], format: 'video', duration: '1h 45m', isMandatory: false, isNewJoinerCourse: false, newJoinerOrder: null, videoUrl: 'https://vimeo.com/trn-003', thumbnailUrl: null, status: 'active', createdBy: 'EMP-0001', createdAt: '2026-01-20T10:00:00Z' },
  { id: 'TRN-004', title: 'Advanced Sales Negotiation', description: '<p>Techniques for closing enterprise deals.</p>', category: 'Sales', departmentAccess: ['Sales'], format: 'video', duration: '50m', isMandatory: false, isNewJoinerCourse: false, newJoinerOrder: null, videoUrl: 'https://vimeo.com/trn-004', thumbnailUrl: null, status: 'active', createdBy: 'EMP-0001', createdAt: '2026-03-01T10:00:00Z' },
  { id: 'TRN-005', title: 'Growth Marketing Fundamentals', description: '<p>Channels, funnels and experimentation basics.</p>', category: 'Marketing', departmentAccess: ['Marketing'], format: 'mixed', duration: '2h', isMandatory: false, isNewJoinerCourse: false, newJoinerOrder: null, videoUrl: 'https://vimeo.com/trn-005', thumbnailUrl: null, status: 'active', createdBy: 'EMP-0001', createdAt: '2026-03-10T10:00:00Z' },
  { id: 'TRN-006', title: 'Lean Operations Playbook', description: '<p>Process mapping and continuous improvement.</p>', category: 'Operations', departmentAccess: ['Operations'], format: 'document', duration: '1h', isMandatory: false, isNewJoinerCourse: false, newJoinerOrder: null, videoUrl: null, thumbnailUrl: null, status: 'active', createdBy: 'EMP-0001', createdAt: '2026-03-15T10:00:00Z' },
  { id: 'TRN-007', title: 'Data Security Awareness', description: '<p>Phishing, password hygiene and data handling.</p>', category: 'Technical', departmentAccess: ['all'], format: 'quiz', duration: '30m', isMandatory: true, isNewJoinerCourse: false, newJoinerOrder: null, videoUrl: null, thumbnailUrl: null, status: 'active', createdBy: 'EMP-0001', createdAt: '2026-01-05T10:00:00Z' },
  { id: 'TRN-008', title: 'Design Systems 101', description: '<p>Tokens, components and Figma workflows.</p>', category: 'Technical', departmentAccess: ['Design'], format: 'video', duration: '1h 20m', isMandatory: false, isNewJoinerCourse: false, newJoinerOrder: null, videoUrl: 'https://vimeo.com/trn-008', thumbnailUrl: null, status: 'active', createdBy: 'EMP-0001', createdAt: '2026-04-01T10:00:00Z' },
  { id: 'TRN-009', title: 'Customer Success Playbook', description: '<p>Onboarding, QBRs and churn prevention.</p>', category: 'Operations', departmentAccess: ['Customer Success'], format: 'video', duration: '1h 10m', isMandatory: false, isNewJoinerCourse: false, newJoinerOrder: null, videoUrl: 'https://vimeo.com/trn-009', thumbnailUrl: null, status: 'active', createdBy: 'EMP-0001', createdAt: '2026-04-10T10:00:00Z' },
  { id: 'TRN-010', title: 'POSH & Workplace Ethics', description: '<p>Mandatory workplace conduct training.</p>', category: 'HR', departmentAccess: ['all'], format: 'video', duration: '45m', isMandatory: true, isNewJoinerCourse: false, newJoinerOrder: null, videoUrl: 'https://vimeo.com/trn-010', thumbnailUrl: null, status: 'active', createdBy: 'EMP-0001', createdAt: '2026-01-10T10:00:00Z' },

  // New Joiner mandatory onboarding checklist — watched in newJoinerOrder sequence.
  { id: 'TRN-NJ-001', title: 'Welcome to Acme — Company Overview', description: '<p>History, mission and how we work.</p>', category: 'HR', departmentAccess: ['all'], format: 'video', duration: '20m', isMandatory: true, isNewJoinerCourse: true, newJoinerOrder: 1, videoUrl: 'https://vimeo.com/trn-nj-001', thumbnailUrl: null, status: 'active', createdBy: 'EMP-0001', createdAt: '2026-01-01T10:00:00Z' },
  { id: 'TRN-NJ-002', title: 'Code of Conduct & Compliance', description: '<p>Ethics, POSH and reporting channels.</p>', category: 'HR', departmentAccess: ['all'], format: 'video', duration: '25m', isMandatory: true, isNewJoinerCourse: true, newJoinerOrder: 2, videoUrl: 'https://vimeo.com/trn-nj-002', thumbnailUrl: null, status: 'active', createdBy: 'EMP-0001', createdAt: '2026-01-01T10:00:00Z' },
  { id: 'TRN-NJ-003', title: 'IT Setup & Security Basics', description: '<p>Devices, VPN and password hygiene.</p>', category: 'Technical', departmentAccess: ['all'], format: 'video', duration: '15m', isMandatory: true, isNewJoinerCourse: true, newJoinerOrder: 3, videoUrl: 'https://vimeo.com/trn-nj-003', thumbnailUrl: null, status: 'active', createdBy: 'EMP-0001', createdAt: '2026-01-01T10:00:00Z' },
  { id: 'TRN-NJ-004', title: 'Benefits & Payroll Walkthrough', description: '<p>Health cover, PF and how payslips work.</p>', category: 'HR', departmentAccess: ['all'], format: 'video', duration: '20m', isMandatory: true, isNewJoinerCourse: true, newJoinerOrder: 4, videoUrl: 'https://vimeo.com/trn-nj-004', thumbnailUrl: null, status: 'active', createdBy: 'EMP-0001', createdAt: '2026-01-01T10:00:00Z' },
  { id: 'TRN-NJ-005', title: 'Meet the Leadership Team', description: '<p>Who\'s who across the org.</p>', category: 'HR', departmentAccess: ['all'], format: 'video', duration: '18m', isMandatory: true, isNewJoinerCourse: true, newJoinerOrder: 5, videoUrl: 'https://vimeo.com/trn-nj-005', thumbnailUrl: null, status: 'active', createdBy: 'EMP-0001', createdAt: '2026-01-01T10:00:00Z' },
  { id: 'TRN-NJ-006', title: 'Workplace Safety & POSH Basics', description: '<p>Safety protocols and respectful workplace basics.</p>', category: 'HR', departmentAccess: ['all'], format: 'video', duration: '22m', isMandatory: true, isNewJoinerCourse: true, newJoinerOrder: 6, videoUrl: 'https://vimeo.com/trn-nj-006', thumbnailUrl: null, status: 'active', createdBy: 'EMP-0001', createdAt: '2026-01-01T10:00:00Z' },
  { id: 'TRN-NJ-007', title: 'Tools & Systems Walkthrough', description: '<p>HRMS, Slack, and the tools you\'ll use daily.</p>', category: 'Technical', departmentAccess: ['all'], format: 'video', duration: '30m', isMandatory: true, isNewJoinerCourse: true, newJoinerOrder: 7, videoUrl: 'https://vimeo.com/trn-nj-007', thumbnailUrl: null, status: 'active', createdBy: 'EMP-0001', createdAt: '2026-01-01T10:00:00Z' },
];

export const myEnrollments = [
  // EMP-0001 — regular courses
  { id: 'ENR-001', courseId: 'TRN-001', employeeId: 'EMP-0001', enrolledOn: '2026-06-01', progress: 65, completedOn: null, score: null, certificateUrl: null, isOverdue: false, deadline: null },
  { id: 'ENR-002', courseId: 'TRN-003', employeeId: 'EMP-0001', enrolledOn: '2026-05-20', progress: 40, completedOn: null, score: null, certificateUrl: null, isOverdue: false, deadline: null },
  { id: 'ENR-003', courseId: 'TRN-010', employeeId: 'EMP-0001', enrolledOn: '2026-04-10', progress: 100, completedOn: '2026-04-12', score: 92, certificateUrl: '#', isOverdue: false, deadline: null },
  { id: 'ENR-004', courseId: 'TRN-007', employeeId: 'EMP-0001', enrolledOn: '2026-03-05', progress: 100, completedOn: '2026-03-06', score: 88, certificateUrl: '#', isOverdue: false, deadline: null },

  // Other employees, regular courses (for dept-visibility + catalog demo)
  { id: 'ENR-005', courseId: 'TRN-001', employeeId: 'EMP-0002', enrolledOn: '2026-06-10', progress: 30, completedOn: null, score: null, certificateUrl: null, isOverdue: false, deadline: null },
  { id: 'ENR-006', courseId: 'TRN-002', employeeId: 'EMP-0013', enrolledOn: '2026-06-05', progress: 100, completedOn: '2026-06-08', score: 95, certificateUrl: '#', isOverdue: false, deadline: null },

  // EMP-0008 Vivaan Sharma — new joiner (joined 2026-05-05): 3 of 7 completed, 1 in progress.
  { id: 'ENR-007', courseId: 'TRN-NJ-001', employeeId: 'EMP-0008', enrolledOn: '2026-05-05', progress: 100, completedOn: '2026-05-06', score: null, certificateUrl: '#', isOverdue: false, deadline: '2026-06-04' },
  { id: 'ENR-008', courseId: 'TRN-NJ-002', employeeId: 'EMP-0008', enrolledOn: '2026-05-06', progress: 100, completedOn: '2026-05-08', score: null, certificateUrl: '#', isOverdue: false, deadline: '2026-06-04' },
  { id: 'ENR-009', courseId: 'TRN-NJ-003', employeeId: 'EMP-0008', enrolledOn: '2026-05-08', progress: 100, completedOn: '2026-05-09', score: null, certificateUrl: '#', isOverdue: false, deadline: '2026-06-04' },
  { id: 'ENR-010', courseId: 'TRN-NJ-004', employeeId: 'EMP-0008', enrolledOn: '2026-05-09', progress: 55, completedOn: null, score: null, certificateUrl: null, isOverdue: false, deadline: '2026-06-04' },

  // EMP-0016 Vihaan Chopra — new joiner (joined 2026-06-01): 1 of 7 completed, 1 in progress.
  { id: 'ENR-011', courseId: 'TRN-NJ-001', employeeId: 'EMP-0016', enrolledOn: '2026-06-01', progress: 100, completedOn: '2026-06-02', score: null, certificateUrl: '#', isOverdue: false, deadline: '2026-07-01' },
  { id: 'ENR-012', courseId: 'TRN-NJ-002', employeeId: 'EMP-0016', enrolledOn: '2026-06-03', progress: 30, completedOn: null, score: null, certificateUrl: null, isOverdue: true, deadline: '2026-07-01' },
];
