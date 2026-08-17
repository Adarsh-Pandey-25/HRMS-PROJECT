export * from './employees';
export * from './hr';
export * from './talent';
export * from './ops';
export * from './dashboard';
export * from './announcements';
export * from './wellness';

export const initialNotifications = [
  { id: 'N1', type: 'leave', title: 'Leave approved', body: 'Your annual leave for Jun 2–4 was approved.', at: '2026-07-08T09:10:00Z', read: false },
  { id: 'N2', type: 'expense', title: 'Expense pending', body: 'Cab claim of ₹2,500 awaiting approval.', at: '2026-07-08T08:40:00Z', read: false },
  { id: 'N3', type: 'ticket', title: 'New ticket assigned', body: 'TKT-005 “Reimbursement delayed” routed to Finance.', at: '2026-07-08T08:05:00Z', read: false },
  { id: 'N4', type: 'review', title: 'Review due soon', body: 'H1 2026 self-assessment closes Jul 15.', at: '2026-07-07T17:00:00Z', read: true },
  { id: 'N5', type: 'payslip', title: 'Payslip ready', body: 'Your June 2026 payslip is now available.', at: '2026-06-30T18:00:00Z', read: true },
  { id: 'N6', type: 'asset', title: 'Asset assigned', body: 'MacBook Pro 14" has been assigned to you.', at: '2026-06-28T10:00:00Z', read: true },
];
