// ---------------------------------------------------------------------------
//  Assets
// ---------------------------------------------------------------------------
export const assets = [
  { id: 'AST-001', name: 'MacBook Pro 14"', category: 'Laptop', brand: 'Apple', model: 'MBP14-M3', serialNumber: 'C02XY1234', purchaseDate: '2024-01-15', purchaseCost: 180000, warrantyExpiry: '2027-01-15', status: 'assigned', assignedTo: 'EMP-0001', assignedOn: '2024-09-12', location: 'Bangalore HQ' },
  { id: 'AST-002', name: 'Dell XPS 15', category: 'Laptop', brand: 'Dell', model: 'XPS-15-9530', serialNumber: 'DLXPS9530', purchaseDate: '2023-08-20', purchaseCost: 145000, warrantyExpiry: '2026-08-20', status: 'assigned', assignedTo: 'EMP-0002', assignedOn: '2024-09-12', location: 'Bangalore HQ' },
  { id: 'AST-003', name: 'iPhone 15 Pro', category: 'Phone', brand: 'Apple', model: 'A2848', serialNumber: 'IP15P0012', purchaseDate: '2024-03-10', purchaseCost: 135000, warrantyExpiry: '2025-03-10', status: 'assigned', assignedTo: 'EMP-0010', assignedOn: '2024-03-12', location: 'Hyderabad' },
  { id: 'AST-004', name: 'MacBook Air M2', category: 'Laptop', brand: 'Apple', model: 'MBA-M2', serialNumber: 'C02AIR456', purchaseDate: '2023-11-05', purchaseCost: 110000, warrantyExpiry: '2026-11-05', status: 'available', assignedTo: null, assignedOn: null, location: 'Bangalore HQ' },
  { id: 'AST-005', name: 'LG UltraFine 27"', category: 'Monitor', brand: 'LG', model: '27UN880', serialNumber: 'LG27UN01', purchaseDate: '2023-05-18', purchaseCost: 42000, warrantyExpiry: '2026-05-18', status: 'assigned', assignedTo: 'EMP-0003', assignedOn: '2023-06-01', location: 'Bangalore HQ' },
  { id: 'AST-006', name: 'Logitech MX Master 3S', category: 'Peripheral', brand: 'Logitech', model: 'MX3S', serialNumber: 'LGMX3S99', purchaseDate: '2024-02-01', purchaseCost: 9000, warrantyExpiry: '2025-02-01', status: 'in-repair', assignedTo: null, assignedOn: null, location: 'Bangalore HQ' },
  { id: 'AST-007', name: 'ThinkPad X1 Carbon', category: 'Laptop', brand: 'Lenovo', model: 'X1C-G11', serialNumber: 'LNX1C011', purchaseDate: '2022-09-14', purchaseCost: 155000, warrantyExpiry: '2025-09-14', status: 'assigned', assignedTo: 'EMP-0005', assignedOn: '2022-09-20', location: 'Bangalore HQ' },
  { id: 'AST-008', name: 'Herman Miller Aeron', category: 'Furniture', brand: 'Herman Miller', model: 'Aeron-B', serialNumber: 'HMAERON8', purchaseDate: '2021-06-01', purchaseCost: 95000, warrantyExpiry: '2033-06-01', status: 'assigned', assignedTo: 'EMP-0006', assignedOn: '2021-11-02', location: 'Mumbai' },
  { id: 'AST-009', name: 'iPad Pro 12.9"', category: 'Tablet', brand: 'Apple', model: 'iPad-Pro-M2', serialNumber: 'IPADPRO22', purchaseDate: '2024-06-11', purchaseCost: 120000, warrantyExpiry: '2025-06-11', status: 'available', assignedTo: null, assignedOn: null, location: 'Bangalore HQ' },
  { id: 'AST-010', name: 'Dell Latitude 7440', category: 'Laptop', brand: 'Dell', model: 'LAT-7440', serialNumber: 'DLLAT744', purchaseDate: '2020-04-15', purchaseCost: 98000, warrantyExpiry: '2023-04-15', status: 'retired', assignedTo: null, assignedOn: null, location: 'Bangalore HQ' },
];

export const myAssets = assets.filter((a) => a.assignedTo === 'EMP-0001');

export const assetRequests = [
  { id: 'REQ-001', employeeId: 'EMP-0008', assetType: 'Laptop', reason: 'New joinee — no device allotted yet', urgency: 'high', status: 'requested', requestedOn: '2026-07-06' },
  { id: 'REQ-002', employeeId: 'EMP-0016', assetType: 'Monitor', reason: 'Dual monitor setup for productivity', urgency: 'low', status: 'approved', requestedOn: '2026-07-02' },
  { id: 'REQ-003', employeeId: 'EMP-0024', assetType: 'Phone', reason: 'Field sales device', urgency: 'medium', status: 'requested', requestedOn: '2026-07-07' },
];

// ---------------------------------------------------------------------------
//  Expenses
// ---------------------------------------------------------------------------
export const expenses = [
  { id: 'EXP-001', employeeId: 'EMP-0001', category: 'travel', date: '2026-07-05', amount: 2500, currency: 'INR', description: 'Cab to client office — Whitefield', receiptUrl: '#', projectCode: 'PROJ-42', status: 'pending', submittedOn: '2026-07-06', approvedBy: null },
  { id: 'EXP-002', employeeId: 'EMP-0001', category: 'meals', date: '2026-07-04', amount: 1800, currency: 'INR', description: 'Team lunch — offsite planning', receiptUrl: '#', projectCode: null, status: 'approved', submittedOn: '2026-07-04', approvedBy: 'EMP-0013' },
  { id: 'EXP-003', employeeId: 'EMP-0010', category: 'travel', date: '2026-07-01', amount: 12400, currency: 'INR', description: 'Flight to Mumbai — sales pitch', receiptUrl: '#', projectCode: 'SALES-Q3', status: 'pending', submittedOn: '2026-07-02', approvedBy: null },
  { id: 'EXP-004', employeeId: 'EMP-0006', category: 'office', date: '2026-06-28', amount: 3200, currency: 'INR', description: 'Wacom pen replacement', receiptUrl: '#', projectCode: null, status: 'approved', submittedOn: '2026-06-29', approvedBy: 'EMP-0013' },
  { id: 'EXP-005', employeeId: 'EMP-0011', category: 'accommodation', date: '2026-06-25', amount: 8500, currency: 'INR', description: 'Hotel — 2 nights client visit', receiptUrl: '#', projectCode: 'SALES-Q3', status: 'rejected', submittedOn: '2026-06-26', approvedBy: 'EMP-0010' },
  { id: 'EXP-006', employeeId: 'EMP-0001', category: 'office', date: '2026-06-20', amount: 1500, currency: 'INR', description: 'Notebooks & stationery', receiptUrl: '#', projectCode: null, status: 'paid', submittedOn: '2026-06-21', approvedBy: 'EMP-0013', paidOn: '2026-06-30' },
  { id: 'EXP-007', employeeId: 'EMP-0004', category: 'medical', date: '2026-06-18', amount: 4200, currency: 'INR', description: 'Annual health check-up', receiptUrl: '#', projectCode: null, status: 'pending', submittedOn: '2026-06-19', approvedBy: null },
];

export const expensePolicies = [
  { category: 'travel', maxPerClaim: 25000, maxPerMonth: 60000 },
  { category: 'meals', maxPerClaim: 2000, maxPerMonth: 15000 },
  { category: 'accommodation', maxPerClaim: 8000, maxPerMonth: 30000 },
  { category: 'office', maxPerClaim: 5000, maxPerMonth: 10000 },
  { category: 'medical', maxPerClaim: 15000, maxPerMonth: 15000 },
];

// ---------------------------------------------------------------------------
//  Helpdesk
// ---------------------------------------------------------------------------
export const tickets = [
  { id: 'TKT-001', raisedBy: 'EMP-0002', subject: 'Payslip not generated for June', category: 'payroll', priority: 'high', status: 'open', assignedTo: 'EMP-0014', description: 'My June payslip is missing from the portal. Please check.', attachments: [], comments: [{ by: 'EMP-0014', text: 'Looking into this — will update by EOD.', at: '2026-07-08T10:30:00Z' }], createdAt: '2026-07-08T09:00:00Z', resolvedAt: null, slaDueBy: '2026-07-09T09:00:00Z' },
  { id: 'TKT-002', raisedBy: 'EMP-0008', subject: 'Laptop not assigned yet', category: 'it', priority: 'critical', status: 'in-progress', assignedTo: 'EMP-0020', description: 'Joined 3 days ago, still waiting for a work laptop.', attachments: [], comments: [{ by: 'EMP-0020', text: 'Device is being provisioned, ready tomorrow.', at: '2026-07-07T14:00:00Z' }], createdAt: '2026-07-06T11:00:00Z', resolvedAt: null, slaDueBy: '2026-07-07T11:00:00Z' },
  { id: 'TKT-003', raisedBy: 'EMP-0011', subject: 'Update emergency contact details', category: 'hr', priority: 'low', status: 'resolved', assignedTo: 'EMP-0015', description: 'Please update my emergency contact number.', attachments: [], comments: [{ by: 'EMP-0015', text: 'Updated in the system. Thanks!', at: '2026-07-05T16:00:00Z' }], createdAt: '2026-07-05T10:00:00Z', resolvedAt: '2026-07-05T16:00:00Z', slaDueBy: '2026-07-08T10:00:00Z' },
  { id: 'TKT-004', raisedBy: 'EMP-0018', subject: 'VPN access request', category: 'it', priority: 'medium', status: 'waiting', assignedTo: 'EMP-0020', description: 'Need VPN access to connect from home.', attachments: [], comments: [{ by: 'EMP-0020', text: 'Awaiting manager approval.', at: '2026-07-07T09:30:00Z' }], createdAt: '2026-07-06T15:00:00Z', resolvedAt: null, slaDueBy: '2026-07-08T15:00:00Z' },
  { id: 'TKT-005', raisedBy: 'EMP-0023', subject: 'Reimbursement delayed', category: 'finance', priority: 'medium', status: 'open', assignedTo: 'EMP-0013', description: 'My travel reimbursement from last month is pending.', attachments: [], comments: [], createdAt: '2026-07-08T08:00:00Z', resolvedAt: null, slaDueBy: '2026-07-10T08:00:00Z' },
  { id: 'TKT-006', raisedBy: 'EMP-0001', subject: 'Access to admin dashboard', category: 'it', priority: 'low', status: 'closed', assignedTo: 'EMP-0020', description: 'Requesting elevated dashboard access.', attachments: [], comments: [{ by: 'EMP-0020', text: 'Access granted.', at: '2026-07-03T12:00:00Z' }], createdAt: '2026-07-02T09:00:00Z', resolvedAt: '2026-07-03T12:00:00Z', slaDueBy: '2026-07-05T09:00:00Z' },
];

export const kbCategories = [
  { id: 'it', name: 'IT Setup', count: 12, icon: 'Monitor' },
  { id: 'payroll', name: 'Payroll FAQs', count: 8, icon: 'DollarSign' },
  { id: 'leave', name: 'Leave Policies', count: 6, icon: 'CalendarOff' },
  { id: 'benefits', name: 'Benefits', count: 9, icon: 'Gift' },
  { id: 'onboarding', name: 'Onboarding', count: 5, icon: 'UserPlus' },
];

export const kbArticles = [
  { id: 'KB-01', category: 'it', title: 'How to set up VPN on your laptop', updatedOn: '2026-06-20', views: 342 },
  { id: 'KB-02', category: 'payroll', title: 'Understanding your salary breakup', updatedOn: '2026-06-15', views: 511 },
  { id: 'KB-03', category: 'leave', title: 'How to apply for leave & approval flow', updatedOn: '2026-05-30', views: 289 },
  { id: 'KB-04', category: 'benefits', title: 'Health insurance coverage explained', updatedOn: '2026-06-01', views: 198 },
  { id: 'KB-05', category: 'onboarding', title: 'First week checklist for new joiners', updatedOn: '2026-07-01', views: 156 },
];

export const ticketsByCategory = [
  { category: 'IT', count: 28 }, { category: 'HR', count: 19 },
  { category: 'Payroll', count: 14 }, { category: 'Finance', count: 9 },
  { category: 'Admin', count: 7 },
];

export const resolutionTrend = ['Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul'].map((m, i) => ({
  month: m,
  hours: [18, 16, 15, 13, 11, 9][i],
}));
