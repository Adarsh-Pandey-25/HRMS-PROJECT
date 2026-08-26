import { useState, useMemo, useEffect } from 'react';
import { useParams, useNavigate, Link, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  ArrowLeft, Mail, Phone, MapPin, Calendar, Pencil, User, Briefcase, Clock,
  CalendarOff, DollarSign, Monitor, FileText, GitBranch, Download, Building2,
  CreditCard, Shield, Phone as PhoneIcon, Upload, CheckCircle2, Trash2, Eye, Plus,
} from 'lucide-react';
import {
  Card, CardHeader, Button, Avatar, StatusBadge, Tabs, EmptyState, Skeleton,
  Modal, Select, Input, Textarea,
} from '../../components/ui';
import { AttendanceCalendar } from '../../components/shared/AttendanceCalendar';
import { useEmployee, useEmployeeMap } from '../../hooks/useEmployees';
import { useAccessibleCompanies } from '../../hooks/useCompanies';
import { useEmployeeAttendanceReport } from '../../hooks/useAttendance';
import { useAllLeaves, useMyLeaves, useTeamLeaves } from '../../hooks/useLeaves';
import { useAssets, useMyAssets } from '../../hooks/useModules';
import { useEmployeeDocuments, useDocumentMutations } from '../../hooks/useDocuments';
import { useCareerEvents, useCareerEventMutations } from '../../hooks/useCareerEvents';
import { DOCUMENT_TYPE_OPTIONS, openDocumentApi } from '../../api/documents.api';
import { useAllPayslipsForYear, downloadPayslipApi } from '../../hooks/usePayroll';
import { PayslipPreviewModal } from '../../components/payroll/PayslipPreviewModal';
import { useCompanyStore } from '../../store/companyStore';
import { useAuthStore } from '../../store/authStore';
import { useCan } from '../../hooks/useCan';
import { formatDate, formatCurrency, humanize } from '../../lib/utils';
import { employeeEditPath, employeeProfilePath, isOwnEmployeeProfileSlug, resolveEmployeeId } from '../../lib/employeeRoutes';

const TABS = [
  { id: 'overview', label: 'Overview', icon: User },
  { id: 'work', label: 'Work Info', icon: Briefcase },
  { id: 'attendance', label: 'Attendance', icon: Clock },
  { id: 'leave', label: 'Leave', icon: CalendarOff },
  { id: 'payroll', label: 'Payroll', icon: DollarSign },
  { id: 'assets', label: 'Assets', icon: Monitor },
  { id: 'documents', label: 'Documents', icon: FileText },
  { id: 'timeline', label: 'Timeline', icon: GitBranch },
];

const CAREER_EVENT_ICONS = {
  joined: User,
  designation_change: Briefcase,
  department_change: Building2,
  manager_change: User,
  salary_change: DollarSign,
  note: FileText,
};

/** Resolve a manager_change from/to value (an employee id) to a display name. */
function resolveCareerValue(type, value, employeeMap) {
  if (value == null || value === '') return null;
  if (type === 'manager_change') return employeeMap[value]?.name || value;
  return value;
}

function careerEventText(ev, employeeMap) {
  const from = resolveCareerValue(ev.type, ev.fromValue, employeeMap);
  const to = resolveCareerValue(ev.type, ev.toValue, employeeMap);
  switch (ev.type) {
    case 'joined':
      return `Joined as ${to || 'team member'}`;
    case 'designation_change':
      return from ? `Designation changed from ${from} to ${to || '—'}` : `Designation set to ${to || '—'}`;
    case 'department_change':
      return from ? `Department changed from ${from} to ${to || '—'}` : `Department set to ${to || '—'}`;
    case 'manager_change':
      return from ? `Reporting manager changed from ${from} to ${to || '—'}` : `Reporting manager set to ${to || '—'}`;
    case 'salary_change':
      return 'Salary details updated';
    case 'note':
      return ev.note || 'Career note';
    default:
      return ev.typeLabel || 'Career event';
  }
}

function InfoRow({ icon: Icon, label, value }) {
  return (
    <div className="flex items-start gap-3 py-2.5">
      <Icon className="h-4 w-4 text-fg-subtle mt-0.5 shrink-0" />
      <div className="min-w-0">
        <p className="text-xs text-fg-subtle">{label}</p>
        <p className="text-sm text-fg font-medium break-words">{value || '—'}</p>
      </div>
    </div>
  );
}

export default function EmployeeProfile() {
  const { id: slug } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const canManage = useCan('employees', 'edit');
  const canViewDirectory = useCan('employees', 'view');
  const role = useAuthStore((s) => s.role);
  const user = useAuthStore((s) => s.user);
  const isHrAdmin = role === 'admin' || role === 'hr';
  const employeeMap = useEmployeeMap();
  const id = useMemo(() => resolveEmployeeId(slug, employeeMap), [slug, employeeMap]);
  const isOwnProfile = isOwnEmployeeProfileSlug(slug, user)
    || Boolean(user?.id && id && String(user.id) === String(id));
  const tabFromUrl = searchParams.get('tab');
  const validTab = TABS.some((t) => t.id === tabFromUrl) ? tabFromUrl : 'overview';
  const [tab, setTab] = useState(validTab);
  const now = new Date();
  const { data: emp, isLoading } = useEmployee(id);
  const { data: accessibleCompanies = [] } = useAccessibleCompanies(Boolean(isHrAdmin));
  const brandedCompany = useCompanyStore((s) => s.company);
  const brandedHomeName = brandedCompany?.name?.trim();
  const brandedHomeId = String(brandedCompany?.companyId || '');
  const resolvedCompanyName = useMemo(() => {
    const cid = String(emp?.companyId || emp?.company_id || '');
    const accessible = accessibleCompanies.find((c) => String(c.id) === cid);
    if (accessible?.isHome && brandedHomeName) return brandedHomeName;
    if (brandedHomeId && cid && brandedHomeId === cid && brandedHomeName) return brandedHomeName;
    if (emp?.companyName) return emp.companyName;
    if (emp?.company?.name) return emp.company?.name;
    if (!cid) return '';
    return accessible?.name || '';
  }, [emp, accessibleCompanies, brandedHomeId, brandedHomeName]);
  const { data: attendanceReport, isLoading: attendanceLoading } = useEmployeeAttendanceReport(id, {
    month: now.getMonth() + 1,
    year: now.getFullYear(),
  });
  const attendanceRows = attendanceReport?.records ?? [];
  const attendanceSummary = attendanceReport?.summary;
  // Leave/asset data is scoped to what the viewer is actually allowed to see:
  // HR/Admin can see the whole org, a manager can see their reports' data via the
  // team-scoped endpoint, and everyone else can only ever see their own record.
  const { data: allLeavesAdmin = [] } = useAllLeaves({ enabled: isHrAdmin });
  const { data: myLeavesData = [] } = useMyLeaves({ enabled: !isHrAdmin && isOwnProfile });
  const { data: teamLeavesData = [] } = useTeamLeaves({ enabled: !isHrAdmin && !isOwnProfile });
  const { data: allAssets = [] } = useAssets();
  const { data: myAssetsData = [] } = useMyAssets({ enabled: !isHrAdmin && isOwnProfile });
  const { data: documents = [], isLoading: docsLoading } = useEmployeeDocuments(id);
  const { upload, verify, remove } = useDocumentMutations();
  const { data: payslips = [] } = useAllPayslipsForYear(now.getFullYear());
  const { data: careerEvents = [], isLoading: careerLoading } = useCareerEvents(id);
  const { addNote } = useCareerEventMutations(id);
  const companyName = brandedHomeName;
  const [viewingPayslip, setViewingPayslip] = useState(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadForm, setUploadForm] = useState({ documentType: 'aadhar', documentName: '', file: null });
  const [openingId, setOpeningId] = useState(null);
  const [noteModalOpen, setNoteModalOpen] = useState(false);
  const [noteForm, setNoteForm] = useState({ note: '', effectiveDate: new Date().toISOString().slice(0, 10) });

  useEffect(() => {
    if (tabFromUrl && TABS.some((t) => t.id === tabFromUrl)) {
      setTab(tabFromUrl);
    }
  }, [tabFromUrl]);

  const managerName = useMemo(() => {
    if (!emp?.reportingTo) return '—';
    const m = employeeMap[emp.reportingTo];
    return m?.name || '—';
  }, [emp?.reportingTo, employeeMap]);

  const attendanceByDay = useMemo(() => {
    const map = {};
    for (const row of attendanceRows) {
      const day = Number(String(row.date).slice(8, 10));
      if (!day) continue;
      const status = row.status === 'half_day' ? 'half-day' : row.status;
      map[day] = ['present', 'wfh', 'late', 'absent', 'half-day', 'on-leave', 'leave'].includes(status)
        ? status
        : 'present';
    }
    return map;
  }, [attendanceRows]);

  const attendanceStats = useMemo(() => {
    const empty = { present: 0, wfh: 0, late: 0, absent: 0 };
    if (!attendanceRows.length) return empty;
    return {
      present: attendanceSummary?.present ?? 0,
      wfh: attendanceSummary?.wfh ?? 0,
      late: attendanceSummary?.late ?? 0,
      absent: attendanceSummary?.absent ?? 0,
    };
  }, [attendanceRows.length, attendanceSummary]);

  const empLeaves = useMemo(() => {
    const source = isHrAdmin ? allLeavesAdmin : (isOwnProfile ? myLeavesData : teamLeavesData);
    return source.filter((l) => l.employeeId === id);
  }, [isHrAdmin, isOwnProfile, allLeavesAdmin, myLeavesData, teamLeavesData, id]);
  const empAssets = useMemo(() => {
    const source = isHrAdmin ? allAssets : (isOwnProfile ? myAssetsData : []);
    return source.filter((a) => a.assignedTo === id);
  }, [isHrAdmin, isOwnProfile, allAssets, myAssetsData, id]);
  const empPayslips = useMemo(() => payslips.filter((p) => p.employeeId === id), [payslips, id]);

  if (isLoading) {
    return <Card className="p-8"><Skeleton className="h-32 rounded-xl" /></Card>;
  }

  if (!emp) {
    return (
      <Card className="py-6">
        <EmptyState
          title="Employee not found"
          message="This employee record doesn't exist."
          action={<Link to={canViewDirectory ? '/employees' : '/dashboard'}><Button>{canViewDirectory ? 'Back to directory' : 'Back to Dashboard'}</Button></Link>}
        />
      </Card>
    );
  }

  // Self-service only: without directory View, employees may open their own profile.
  if (!canViewDirectory && !isOwnProfile) {
    return (
      <Card className="py-6">
        <EmptyState
          title="Access restricted"
          message="You can only view your own profile. An Admin can grant Employee Management access from Settings → User & Role Management."
          action={<Link to="/dashboard"><Button>Back to Dashboard</Button></Link>}
        />
      </Card>
    );
  }

  const salary = emp.salary || { basic: 0, hra: 0, da: 0, special: 0, transport: 0, medical: 0, pf: 0 };
  const gross = salary.basic + salary.hra + salary.da + salary.special + (salary.transport || 0) + (salary.medical || 0);
  const net = gross - salary.pf - (salary.pt || 200) - Math.round(gross * 0.08);
  const bank = emp.bank || { name: '', account: '', ifsc: '' };
  const ec = emp.emergencyContact || { name: '', phone: '', relation: '' };
  const isAdminAccount = emp.role === 'admin';
  const backPath = isAdminAccount || !canViewDirectory ? '/dashboard' : '/employees';
  const backLabel = isAdminAccount || !canViewDirectory ? 'Back to Dashboard' : 'Back to Employees';

  return (
    <div className="space-y-6 animate-fade-in">
      <button onClick={() => navigate(backPath)} className="flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg transition-colors">
        <ArrowLeft className="h-4 w-4" /> {backLabel}
      </button>

      {/* Header */}
      <Card className="p-6">
        <div className="flex flex-col sm:flex-row sm:items-center gap-5">
          <Avatar name={emp.name} src={emp.avatar} size="xl" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-page-title text-fg">{emp.name}</h1>
              <StatusBadge status={emp.status} />
            </div>
            <p className="mt-1 text-sm text-fg-muted">{emp.designation} · {emp.department}</p>
            {resolvedCompanyName && (
              <p className="mt-1.5 inline-flex items-center gap-1.5 text-sm font-medium text-fg">
                <Building2 className="h-4 w-4 text-primary shrink-0" />
                <span className="text-fg-subtle font-normal">Company</span>
                {resolvedCompanyName}
              </p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-fg-subtle">
              <span className="flex items-center gap-1.5"><Shield className="h-3.5 w-3.5" /> {emp.employeeCode || emp.id}</span>
              <span className="flex items-center gap-1.5"><Mail className="h-3.5 w-3.5" /> {emp.workEmail}</span>
              <span className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" /> {emp.workLocation}</span>
              <span className="flex items-center gap-1.5"><Calendar className="h-3.5 w-3.5" /> Joined {formatDate(emp.joinDate)}</span>
            </div>
          </div>
          {canManage && (
            <Button variant="outline" icon={Pencil} onClick={() => navigate(employeeEditPath(emp))}>Edit</Button>
          )}
        </div>
      </Card>

      <Tabs tabs={TABS} value={tab} onChange={setTab} />

      {/* Overview */}
      {tab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader title="Personal Information" />
            <div className="px-5 pb-4 divide-y divide-border/50">
              <InfoRow icon={User} label="Full name" value={emp.name} />
              <InfoRow icon={Building2} label="Company" value={resolvedCompanyName || '—'} />
              <InfoRow icon={Calendar} label="Date of birth" value={formatDate(emp.dob)} />
              <InfoRow icon={User} label="Gender" value={humanize(emp.gender) || '—'} />
              <InfoRow icon={Mail} label="Personal email" value={emp.personalEmail} />
              <InfoRow icon={Phone} label="Phone" value={emp.phone} />
              <InfoRow icon={MapPin} label="Address" value={emp.address} />
            </div>
          </Card>
          <div className="space-y-4">
            <Card>
              <CardHeader title="Emergency Contact" />
              <div className="px-5 pb-4 divide-y divide-border/50">
                <InfoRow icon={User} label="Name" value={ec.name} />
                <InfoRow icon={PhoneIcon} label="Phone" value={ec.phone} />
                <InfoRow icon={User} label="Relation" value={ec.relation} />
              </div>
            </Card>
            <Card>
              <CardHeader title="Bank Details" />
              <div className="px-5 pb-4 divide-y divide-border/50">
                <InfoRow icon={Building2} label="Bank" value={bank.name} />
                <InfoRow icon={CreditCard} label="Account no." value={bank.account} />
                <InfoRow icon={CreditCard} label="IFSC" value={bank.ifsc} />
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* Work Info */}
      {tab === 'work' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader title="Employment" />
            <div className="px-5 pb-4 divide-y divide-border/50">
              <InfoRow icon={Briefcase} label="Designation" value={emp.designation} />
              <InfoRow icon={Building2} label="Company" value={resolvedCompanyName || '—'} />
              <InfoRow icon={Building2} label="Department" value={emp.department} />
              <InfoRow icon={Briefcase} label="Employment type" value={humanize(emp.employmentType)} />
              <InfoRow icon={User} label="Reporting manager" value={managerName} />
            </div>
          </Card>
          <Card>
            <CardHeader title="Work Setup" />
            <div className="px-5 pb-4 divide-y divide-border/50">
              <InfoRow icon={MapPin} label="Work location" value={emp.workLocation} />
              <InfoRow
                icon={Shield}
                label="Attendance type"
                value={
                  emp.attendanceMode === 'wfh'
                    ? 'WFH'
                    : emp.attendanceMode === 'hybrid'
                      ? 'Hybrid'
                      : 'Office'
                }
              />
              <InfoRow icon={Clock} label="Shift" value={emp.shift} />
              <InfoRow icon={Shield} label="System role" value={humanize(emp.role)} />
              <InfoRow icon={Calendar} label="Join date" value={formatDate(emp.joinDate)} />
            </div>
          </Card>
        </div>
      )}

      {/* Attendance */}
      {tab === 'attendance' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-2 p-5">
            {attendanceLoading ? (
              <Skeleton className="h-64 rounded-xl" />
            ) : attendanceRows.length === 0 ? (
              <EmptyState
                icon={Clock}
                title="No attendance yet"
                message="Records appear here after this employee checks in from Attendance, or when HR adds a manual entry."
              />
            ) : (
              <AttendanceCalendar year={now.getFullYear()} month={now.getMonth()} statusByDay={attendanceByDay} today={now.getDate()} />
            )}
          </Card>
          <div className="space-y-4">
            {[
              ['Present', attendanceStats.present, 'text-success'],
              ['WFH', attendanceStats.wfh, 'text-primary'],
              ['Late', attendanceStats.late, 'text-warning'],
              ['Absent', attendanceStats.absent, 'text-danger'],
            ].map(([label, val, tone]) => (
              <Card key={label} className="p-4 flex items-center justify-between">
                <span className="text-sm text-fg-muted">{label} days</span>
                <span className={`text-xl font-semibold ${tone}`}>{val}</span>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Leave */}
      {tab === 'leave' && (
        <Card>
          <CardHeader title="Leave History" subtitle={`${empLeaves.length} requests`} />
          <div className="p-5 pt-3">
            {empLeaves.length === 0 ? (
              <EmptyState icon={CalendarOff} title="No leave records" message="This employee hasn't applied for leave yet." />
            ) : (
              <div className="space-y-2">
                {empLeaves.map((l) => (
                  <div key={l.id} className="flex items-center gap-4 rounded-xl border border-border/60 p-3">
                    <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                      <CalendarOff className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-fg capitalize">{l.type} leave · {l.days} day{l.days > 1 ? 's' : ''}</p>
                      <p className="text-xs text-fg-subtle">{formatDate(l.from)} – {formatDate(l.to)} · {l.reason}</p>
                    </div>
                    <StatusBadge status={l.status} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Payroll */}
      {tab === 'payroll' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[['Gross (monthly)', gross], ['Net pay', net], ['Basic', salary.basic], ['Employer PF', salary.pf]].map(([l, v]) => (
              <Card key={l} className="p-4">
                <p className="text-xs text-fg-subtle">{l}</p>
                <p className="text-lg font-semibold text-fg mt-1">{formatCurrency(v)}</p>
              </Card>
            ))}
          </div>
          <Card>
            <CardHeader title="Payslip History" />
            <div className="p-5 pt-3 space-y-2">
              {empPayslips.length === 0 ? (
                <p className="text-sm text-fg-subtle">No payslips published yet.</p>
              ) : empPayslips.map((p) => (
                <div key={p.id} className="flex items-center gap-4 rounded-xl border border-border/60 p-3">
                  <div className="h-10 w-10 rounded-lg bg-success/10 text-success flex items-center justify-center shrink-0">
                    <DollarSign className="h-5 w-5" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-fg">{formatDate(`${p.month}-01`, 'MMMM yyyy')}</p>
                    <p className="text-xs text-fg-subtle">Net {formatCurrency(p.netPay)}</p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setViewingPayslip(p)}>View</Button>
                  <Button variant="ghost" size="sm" icon={Download} onClick={async () => {
                    try { await downloadPayslipApi(p.id); } catch (err) { toast.error(err.message || 'Download failed'); }
                  }}>PDF</Button>
                </div>
              ))}
            </div>
          </Card>
          <PayslipPreviewModal
            open={Boolean(viewingPayslip)}
            onClose={() => setViewingPayslip(null)}
            payslip={viewingPayslip}
            employeeName={emp?.name}
            companyName={companyName}
          />
        </div>
      )}

      {/* Assets */}
      {tab === 'assets' && (
        <Card>
          <CardHeader title="Assigned Assets" subtitle={`${empAssets.length} items`} />
          <div className="p-5 pt-3">
            {empAssets.length === 0 ? (
              <EmptyState icon={Monitor} title="No assets assigned" message="This employee has no company assets." />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {empAssets.map((a) => (
                  <div key={a.id} className="flex items-center gap-3 rounded-xl border border-border/60 p-3">
                    <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                      <Monitor className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-fg truncate">{a.name}</p>
                      <p className="text-xs text-fg-subtle">{a.serialNumber} · since {formatDate(a.assignedOn, 'MMM yyyy')}</p>
                    </div>
                    <StatusBadge status={a.status} dot={false} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Documents */}
      {tab === 'documents' && (
        <Card>
          <CardHeader
            title="Documents"
            subtitle="Offer letters, contracts & ID proofs"
            action={isHrAdmin ? (
              <Button size="sm" icon={Upload} onClick={() => {
                setUploadForm({ documentType: 'aadhar', documentName: '', file: null });
                setUploadOpen(true);
              }}
              >
                Upload
              </Button>
            ) : null}
          />
          <div className="p-5 pt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {docsLoading ? (
              <Skeleton className="h-16 rounded-xl col-span-2" />
            ) : documents.length === 0 ? (
              <EmptyState
                icon={FileText}
                title="No documents"
                message={isHrAdmin ? 'Upload offer letters, ID proofs or certificates for this employee.' : 'No documents uploaded for this employee.'}
                action={isHrAdmin ? (
                  <Button size="sm" icon={Upload} onClick={() => setUploadOpen(true)}>Upload document</Button>
                ) : undefined}
              />
            ) : documents.map((doc) => (
              <div key={doc.id} className="flex items-center gap-3 rounded-xl border border-border/60 p-3">
                <div className="h-10 w-10 rounded-lg bg-danger/10 text-danger flex items-center justify-center shrink-0">
                  <FileText className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-fg truncate">{doc.name}</p>
                  <p className="text-xs text-fg-subtle">
                    {humanize(doc.type)} · {doc.isVerified ? 'Verified' : 'Pending'}
                    {doc.uploadedAt ? ` · ${formatDate(doc.uploadedAt)}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={Eye}
                    title="View"
                    disabled={openingId === doc.id}
                    onClick={async () => {
                      setOpeningId(doc.id);
                      try {
                        await openDocumentApi(doc.id);
                      } catch (err) {
                        toast.error(err.message || 'Could not open document');
                      } finally {
                        setOpeningId(null);
                      }
                    }}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={Download}
                    title="Download"
                    disabled={openingId === doc.id}
                    onClick={async () => {
                      setOpeningId(doc.id);
                      try {
                        await openDocumentApi(doc.id);
                      } catch (err) {
                        toast.error(err.message || 'Could not download document');
                      } finally {
                        setOpeningId(null);
                      }
                    }}
                  />
                  {isHrAdmin && !doc.isVerified && (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={CheckCircle2}
                      title="Verify"
                      disabled={verify.isPending}
                      onClick={async () => {
                        try {
                          await verify.mutateAsync(doc.id);
                          toast.success('Document verified');
                        } catch (err) {
                          toast.error(err.message || 'Verify failed');
                        }
                      }}
                    />
                  )}
                  {isHrAdmin && (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={Trash2}
                      title="Delete"
                      disabled={remove.isPending}
                      onClick={async () => {
                        if (!window.confirm(`Delete "${doc.name}"?`)) return;
                        try {
                          await remove.mutateAsync(doc.id);
                          toast.success('Document deleted');
                        } catch (err) {
                          toast.error(err.message || 'Delete failed');
                        }
                      }}
                    />
                  )}
                </div>
              </div>
            ))}
          </div>

          <Modal
            open={uploadOpen}
            onClose={() => setUploadOpen(false)}
            title="Upload document"
            subtitle={emp?.name ? `For ${emp.name}` : undefined}
            footer={(
              <>
                <Button variant="outline" onClick={() => setUploadOpen(false)}>Cancel</Button>
                <Button
                  icon={Upload}
                  disabled={upload.isPending}
                  onClick={async () => {
                    if (!uploadForm.file) return toast.error('Choose a file');
                    if (!uploadForm.documentType) return toast.error('Select document type');
                    try {
                      await upload.mutateAsync({
                        file: uploadForm.file,
                        documentType: uploadForm.documentType,
                        documentName: uploadForm.documentName || uploadForm.file.name,
                        employeeId: id,
                      });
                      toast.success('Document uploaded');
                      setUploadOpen(false);
                    } catch (err) {
                      toast.error(err.message || 'Upload failed');
                    }
                  }}
                >
                  {upload.isPending ? 'Uploading…' : 'Upload'}
                </Button>
              </>
            )}
          >
            <div className="space-y-4">
              <Select
                label="Document type"
                required
                value={uploadForm.documentType}
                onChange={(e) => setUploadForm((f) => ({ ...f, documentType: e.target.value }))}
                options={DOCUMENT_TYPE_OPTIONS}
              />
              <Input
                label="Display name"
                placeholder={uploadForm.file?.name || 'e.g. Aadhaar card'}
                value={uploadForm.documentName}
                onChange={(e) => setUploadForm((f) => ({ ...f, documentName: e.target.value }))}
              />
              <Input
                label="File"
                type="file"
                required
                accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                onChange={(e) => {
                  const file = e.target.files?.[0] || null;
                  setUploadForm((f) => ({
                    ...f,
                    file,
                    documentName: f.documentName || file?.name || '',
                  }));
                }}
                hint="PDF, DOC, JPG or PNG · up to 5MB"
              />
            </div>
          </Modal>
        </Card>
      )}

      {/* Timeline */}
      {tab === 'timeline' && (
        <Card>
          <CardHeader
            title="Career Timeline"
            subtitle="Promotions, transfers & notes"
            action={isHrAdmin ? (
              <Button
                size="sm"
                icon={Plus}
                onClick={() => {
                  setNoteForm({ note: '', effectiveDate: new Date().toISOString().slice(0, 10) });
                  setNoteModalOpen(true);
                }}
              >
                Add Career Note
              </Button>
            ) : null}
          />
          <div className="p-5 pt-3">
            {careerLoading ? (
              <Skeleton className="h-32 rounded-xl" />
            ) : careerEvents.length === 0 ? (
              <EmptyState
                icon={GitBranch}
                title="No timeline events yet"
                message="Join date and career events will appear here when available."
              />
            ) : (
              <ol className="relative border-l border-border ml-2 space-y-6">
                {careerEvents.map((ev) => {
                  const Icon = CAREER_EVENT_ICONS[ev.type] || GitBranch;
                  return (
                    <li key={ev.id} className="ml-5">
                      <span className="absolute -left-[7px] h-3.5 w-3.5 rounded-full ring-4 ring-card bg-primary" />
                      <p className="text-xs text-fg-subtle">{formatDate(ev.effectiveDate)}</p>
                      <p className="text-sm font-medium text-fg mt-0.5 flex items-center gap-1.5">
                        <Icon className="h-3.5 w-3.5 text-primary shrink-0" />
                        {careerEventText(ev, employeeMap)}
                      </p>
                      {ev.type !== 'note' && ev.note && (
                        <p className="text-xs text-fg-muted mt-0.5">{ev.note}</p>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </div>

          <Modal
            open={noteModalOpen}
            onClose={() => setNoteModalOpen(false)}
            title="Add Career Note"
            subtitle={emp?.name ? `For ${emp.name}` : undefined}
            footer={(
              <>
                <Button variant="outline" onClick={() => setNoteModalOpen(false)}>Cancel</Button>
                <Button
                  icon={Plus}
                  disabled={addNote.isPending}
                  onClick={async () => {
                    if (!noteForm.note.trim()) return toast.error('Enter a note');
                    try {
                      await addNote.mutateAsync({
                        note: noteForm.note.trim(),
                        effectiveDate: noteForm.effectiveDate,
                      });
                      toast.success('Career note added');
                      setNoteModalOpen(false);
                    } catch (err) {
                      toast.error(err.message || 'Could not add note');
                    }
                  }}
                >
                  {addNote.isPending ? 'Saving…' : 'Add note'}
                </Button>
              </>
            )}
          >
            <div className="space-y-4">
              <Textarea
                label="Note"
                required
                rows={4}
                placeholder="e.g. Completed leadership training, recognized as employee of the quarter…"
                value={noteForm.note}
                onChange={(e) => setNoteForm((f) => ({ ...f, note: e.target.value }))}
              />
              <Input
                label="Effective date"
                type="date"
                required
                value={noteForm.effectiveDate}
                onChange={(e) => setNoteForm((f) => ({ ...f, effectiveDate: e.target.value }))}
              />
            </div>
          </Modal>
        </Card>
      )}
    </div>
  );
}
