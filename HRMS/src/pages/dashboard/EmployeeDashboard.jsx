import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { CalendarCheck, CalendarOff, Receipt, LifeBuoy, LogIn, LogOut, DollarSign, Fingerprint } from 'lucide-react';
import toast from 'react-hot-toast';
import { Card, CardHeader, StatCard, Button, StatusBadge, ProgressBar, Skeleton } from '../../components/ui';
import { useDashboardData } from '../../hooks/useDashboardData';
import { useAttendanceMutations, useCheckContext } from '../../hooks/useAttendance';
import { formatDate, formatCurrency, cn } from '../../lib/utils';
import { leaveTypeLabel } from '../../lib/mappers';
import { Greeting, RecentAnnouncements } from './shared';
import { useSelfieCapture } from '../../components/attendance/SelfieCapture';
import { planWebCheckIn, requestGeolocation } from '../../lib/webCheckIn';
import { useAuthStore } from '../../store/authStore';

export default function EmployeeDashboard({ user }) {
 const { data: api, isLoading } = useDashboardData();
 const { checkIn, checkOut } = useAttendanceMutations();
 const { data: checkContext } = useCheckContext();
 const selfie = useSelfieCapture();

 const kpis = api?.kpis || {};
 const todayStatus = api?.todayStatus || {};
 const last7 = api?.last7Days || [];
 const leaveItems = api?.leaveBalances?.items || [];
 const latestPayslip = api?.latestPayslip;
 const openExpenses = api?.openExpenseClaims?.items || [];

 const checkedIn = todayStatus.status === 'checked_in';
 // Same rules as My Attendance, from the shared helper — this card used to
 // send neither the WFH flag nor a location, so it failed where that page
 // worked whenever WFH or the office geofence was involved.
 const role = useAuthStore((st) => st.role);
 const plan = planWebCheckIn(checkContext, { privileged: role === 'admin' || role === 'hr' });
 const webCheckInEnabled = plan.allowed;
 const canCheckIn = todayStatus.canCheckIn && webCheckInEnabled;
 const canCheckOut = todayStatus.canCheckOut;
 // A biometric day can only be closed on the device that opened it — the
 // server rejects a web checkout on one — so the card says which device to
 // use instead of showing a button that would 403 (or, once the server sets
 // canCheckOut false, a misleading "Day Complete").
 const biometricLocked = checkedIn && todayStatus.checkInMethod === 'biometric';

 const totalRemaining = useMemo(
 () => leaveItems.reduce((sum, b) => sum + Number(b.available || 0), 0),
 [leaveItems]
 );

 /** Location when the company's rules need one for this action, else undefined. */
 const locationIfNeeded = async (needed) => {
 if (!needed) return undefined;
 const toastId = toast.loading('Getting your location…');
 try {
 return await requestGeolocation();
 } finally {
 toast.dismiss(toastId);
 }
 };

 const handleCheckInOut = async () => {
 try {
 if (canCheckOut) {
 const location = await locationIfNeeded(plan.needsCheckoutLocation);
 await checkOut.mutateAsync({ method: 'web', location });
 toast.success('Checked out — see you tomorrow!');
 } else if (canCheckIn) {
 const location = await locationIfNeeded(plan.needsLocation);
 let selfieToken;
 if (plan.needsSelfie) {
 selfieToken = await selfie.capture();
 if (!selfieToken) return;
 }
 await checkIn.mutateAsync({ method: 'web', is_wfh: plan.isWfh, location, selfie_token: selfieToken });
 toast.success(plan.isWfh ? 'Checked in as WFH — have a great day!' : 'Checked in — have a great day!');
 }
 } catch (err) {
 toast.error(err.message || 'Attendance action failed');
 }
 };

 if (isLoading) {
 return (
 <div className="space-y-6">
 <Skeleton className="h-10 w-64" />
 <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
 {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28 rounded-card" />)}
 </div>
 </div>
 );
 }

 return (
 <div className="space-y-6 animate-fade-in">
 {selfie.modal}
 <Greeting user={user} dateLabel={api?.greeting?.date} />

 <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
 <StatCard label="Attendance This Month" value={kpis.attendanceThisMonth ?? 0} icon={CalendarCheck} tone="success" footer="Days present" />
 <StatCard label="Leave Balance" value={totalRemaining} icon={CalendarOff} tone="warning" footer="Days remaining" />
 <StatCard label="Pending Expenses" value={kpis.pendingExpenses ?? 0} icon={Receipt} tone="info" footer="Claims in progress" />
 <StatCard label="Open Tickets" value={kpis.openTickets ?? 0} icon={LifeBuoy} tone="primary" footer="Awaiting resolution" />
 </div>

 <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
 <Card className="p-5 flex flex-col justify-between">
 <div>
 <p className="text-xs font-medium text-fg-subtle">Today's Status</p>
 <p className="mt-2 text-lg font-semibold text-fg">{todayStatus.label || 'Not checked in'}</p>
 <p className="mt-1 text-xs text-fg-subtle">
 {todayStatus.checkInLabel && `In ${todayStatus.checkInLabel}`}
 </p>
 </div>
 <Button
 className="mt-4 w-full"
 icon={canCheckOut ? LogOut : biometricLocked ? Fingerprint : LogIn}
 variant={canCheckOut ? 'danger' : 'primary'}
 onClick={handleCheckInOut}
 loading={checkIn.isPending || checkOut.isPending}
 disabled={!canCheckIn && !canCheckOut}
 >
 {canCheckOut
 ? 'Check Out'
 : biometricLocked
 ? 'Check out on device'
 : canCheckIn
 ? 'Check In'
 : !webCheckInEnabled && todayStatus.canCheckIn
 ? (plan.webMode === 'wfh_only' ? 'Check in on the device' : 'Web check-in off')
 : 'Day Complete'}
 </Button>
 {!webCheckInEnabled && todayStatus.canCheckIn && (
 <p className="mt-2 text-[11px] text-fg-subtle">
 {plan.blockedReason}
 {plan.webMode === 'wfh_only' && (
 <>
 {' '}
 <Link to="/attendance/me" className="font-medium text-primary hover:underline">Request WFH</Link>
 </>
 )}
 </p>
 )}
 {biometricLocked && (
 <p className="mt-2 text-[11px] text-fg-subtle">
 Checked in via <span className="font-medium text-fg-muted">Biometric device</span> — please check out on the same device.
 </p>
 )}
 </Card>

 <Card className="lg:col-span-2">
 <div className="p-5 flex items-center justify-between">
 <div>
 <p className="text-sm font-medium text-fg">My Attendance</p>
 <p className="text-xs text-fg-subtle mt-0.5">Last 7 days — <Link to="/attendance/me" className="text-primary hover:underline">View all</Link></p>
 </div>
 </div>
 <div className="px-5 pb-5 grid grid-cols-7 gap-2">
 {last7.map((a) => {
 const tone = {
 present: 'bg-success/15 text-success',
 wfh: 'bg-primary/15 text-primary',
 late: 'bg-warning/15 text-warning',
 absent: 'bg-danger/15 text-danger',
 holiday: 'bg-info/12 text-info',
 weekend: 'bg-muted text-fg-subtle',
 future: 'bg-muted/50 text-fg-subtle',
 none: 'bg-muted text-fg-subtle',
 }[a.state] || 'bg-muted text-fg-subtle';
 return (
 <div key={a.date} title={a.holidayName || undefined} className={`rounded-lg py-2.5 text-center ${tone} ${a.isToday ? 'ring-2 ring-primary' : ''}`}>
 <p className="text-[10px] font-medium">{a.dayLabel}</p>
 <p className="text-xs font-semibold mt-1">{a.dateLabel}</p>
 </div>
 );
 })}
 </div>
 </Card>
 </div>

 <Card>
 <CardHeader title="Leave Balances" subtitle={String(api?.leaveBalances?.year || new Date().getFullYear())} action={<Link to="/leave/apply" className="text-xs font-medium text-primary hover:underline">Apply for leave</Link>} />
 <div className="p-5 pt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
 {leaveItems.length === 0 ? (
 <p className="text-sm text-fg-subtle col-span-full">No leave balance data.</p>
 ) : leaveItems.map((b) => (
 <div key={b.code} className="rounded-xl bg-muted/50 p-4">
 <p className="text-sm font-medium text-fg">{leaveTypeLabel(b.code, b.label || b.name)}</p>
 <p className="mt-1 text-xl font-semibold text-fg tabular-nums">{b.available}<span className="text-xs font-normal text-fg-subtle"> / {b.total} days</span></p>
 <ProgressBar value={b.total ? (b.used / b.total) * 100 : 0} className="mt-2" size="sm" />
 </div>
 ))}
 </div>
 </Card>

 <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
 <Card>
 <CardHeader title="Latest Payslip" subtitle={latestPayslip?.period || ''} action={<Link to="/payroll/me" className="text-xs font-medium text-primary hover:underline">View all</Link>} />
 <div className="p-5 pt-3 flex items-center gap-4">
 <div className="h-11 w-11 rounded-xl bg-success/10 text-success flex items-center justify-center shrink-0">
 <DollarSign className="h-5 w-5" />
 </div>
 <div>
 <p className="text-lg font-semibold text-fg">{latestPayslip ? formatCurrency(latestPayslip.netPay) : '—'}</p>
 <p className="text-xs text-fg-subtle">{latestPayslip?.subtitle || 'No published payslip yet'}</p>
 </div>
 </div>
 </Card>

 <Card>
 <CardHeader title="My Open Expense Claims" subtitle={`${openExpenses.length} claims`} action={<Link to="/expenses/me" className="text-xs font-medium text-primary hover:underline">View all</Link>} />
 <div className="p-5 pt-3 space-y-2">
 {openExpenses.length === 0 ? (
 <p className="text-sm text-fg-subtle">No open claims.</p>
 ) : openExpenses.map((e) => (
 <div key={e.id} className="flex items-center gap-3 rounded-xl p-2 hover:bg-muted transition-colors">
 <div className="h-9 w-9 rounded-lg bg-warning/10 text-warning flex items-center justify-center shrink-0">
 <Receipt className="h-4 w-4" />
 </div>
 <div className="min-w-0 flex-1">
 <p className="text-sm font-medium text-fg truncate">{e.title}</p>
 <p className="text-xs text-fg-subtle">{e.category} · {formatCurrency(e.amount)}</p>
 </div>
 <StatusBadge status={e.status?.toLowerCase()} />
 </div>
 ))}
 </div>
 </Card>
 </div>

 <RecentAnnouncements />
 </div>
 );
}
