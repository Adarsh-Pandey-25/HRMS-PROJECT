import { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Users, CalendarClock, Wallet, CalendarOff } from 'lucide-react';
import { PageHeader, Tabs } from '../../components/ui';
import { useAuthStore } from '../../store/authStore';
import TeamPerformanceReport from './TeamPerformanceReport';
import AttendanceSummaryReport from './AttendanceSummaryReport';
import PayrollSummaryReport from './PayrollSummaryReport';
import LeaveSummaryReport from './LeaveSummaryReport';

const ALL_TABS = [
  { id: 'team-performance', label: 'Team Performance', icon: Users },
  { id: 'attendance-summary', label: 'Attendance Summary', icon: CalendarClock },
  { id: 'payroll-summary', label: 'Payroll Summary', icon: Wallet, hrAdminOnly: true },
  { id: 'leave-summary', label: 'Leave Summary', icon: CalendarOff },
];

export default function Reports() {
  const role = useAuthStore((s) => s.role);
  const isHrOrAdmin = role === 'hr' || role === 'admin';
  // Managers never see subordinate salary data anywhere else in this app —
  // Payroll Summary shouldn't be the one place that quietly breaks that rule.
  const TABS = useMemo(() => ALL_TABS.filter((t) => !t.hrAdminOnly || isHrOrAdmin), [isHrOrAdmin]);

  const [searchParams, setSearchParams] = useSearchParams();
  const tabFromUrl = searchParams.get('tab');
  const validTab = TABS.some((t) => t.id === tabFromUrl) ? tabFromUrl : 'team-performance';
  const [tab, setTab] = useState(validTab);

  const changeTab = (id) => {
    setTab(id);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('tab', id);
      return next;
    }, { replace: true });
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Reports"
        subtitle="Team performance, attendance, payroll, and leave rollups — for managers and above"
      />

      <Tabs tabs={TABS} value={tab} onChange={changeTab} />

      {tab === 'team-performance' && <TeamPerformanceReport />}
      {tab === 'attendance-summary' && <AttendanceSummaryReport />}
      {tab === 'payroll-summary' && <PayrollSummaryReport />}
      {tab === 'leave-summary' && <LeaveSummaryReport />}
    </div>
  );
}
