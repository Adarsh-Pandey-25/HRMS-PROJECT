import { employees } from './employees';
import { DEPARTMENTS } from '../lib/constants';

export const headcountTrend = [
  { month: 'Aug', count: 19 }, { month: 'Sep', count: 20 },
  { month: 'Oct', count: 20 }, { month: 'Nov', count: 21 },
  { month: 'Dec', count: 22 }, { month: 'Jan', count: 22 },
  { month: 'Feb', count: 23 }, { month: 'Mar', count: 24 },
  { month: 'Apr', count: 24 }, { month: 'May', count: 25 },
  { month: 'Jun', count: 26 }, { month: 'Jul', count: 26 },
];

export const departmentDistribution = DEPARTMENTS.map((dept) => ({
  name: dept,
  value: employees.filter((e) => e.department === dept).length,
})).filter((d) => d.value > 0);

export const dashboardKpis = {
  totalEmployees: employees.length,
  totalDelta: 4.0,
  newThisMonth: 2,
  newDelta: -1.0,
  onLeaveToday: 3,
  openPositions: 4,
};

export const upcomingEvents = [
  { type: 'birthday', name: 'Meera Krishnan', date: '2026-07-09', label: 'Birthday' },
  { type: 'anniversary', name: 'Diya Nair', date: '2026-07-01', label: '6 yrs anniversary' },
  { type: 'interview', name: 'Karan Singh', date: '2026-07-08', label: 'Interview 11:00' },
  { type: 'birthday', name: 'Arjun Reddy', date: '2026-07-12', label: 'Birthday' },
  { type: 'anniversary', name: 'Rohan Gupta', date: '2026-07-15', label: '5 yrs anniversary' },
];

export const activityFeed = [
  { id: 1, type: 'hire', actor: 'Vivaan Sharma', text: 'joined as SDE Level 1', at: '2026-07-08T08:30:00Z' },
  { id: 2, type: 'leave', actor: 'Kabir Anand', text: 'leave request approved', at: '2026-07-08T07:15:00Z' },
  { id: 3, type: 'expense', actor: 'Arjun Reddy', text: 'submitted a ₹12,400 expense claim', at: '2026-07-07T18:45:00Z' },
  { id: 4, type: 'review', actor: 'Esther Howard', text: 'submitted H1 self-assessment', at: '2026-07-07T16:20:00Z' },
  { id: 5, type: 'asset', actor: 'IT Team', text: 'assigned MacBook Air to Vihaan Chopra', at: '2026-07-07T14:00:00Z' },
  { id: 6, type: 'ticket', actor: 'Sneha (candidate)', text: 'interview scheduled for Product Designer', at: '2026-07-07T11:30:00Z' },
];

export const pendingApprovals = { leave: 3, expenses: 3, assets: 2 };
