import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { fetchTrainingProgressReport } from '../../lib/training.api'
import { getErrorMessage } from '../../lib/errors'
import { formatStatus } from '../../lib/format'
import { Badge, Button, Card, CardBody, DataTable, EmptyState, Field, Input, LoadingState, PageHeader, Select } from '../../components/ui'
import type { EmployeeCourseProgress, EmployeeTrainingProgress } from '../../lib/training.api'

type ProgressRow = EmployeeTrainingProgress & EmployeeCourseProgress & {
  rowKey: string
  employeeName: string
}

const statusBadge = (status: string) => {
  if (status === 'COMPLETED') return 'completed'
  if (status === 'IN_PROGRESS') return 'in_progress'
  return 'pending'
}

export default function TrainingProgressPage() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [deptFilter, setDeptFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [showUnassigned, setShowUnassigned] = useState(false)

  const report = useQuery({
    queryKey: ['training', 'progress-report'],
    queryFn: fetchTrainingProgressReport,
    staleTime: 2 * 60_000,
  })

  const departments = useMemo(() => {
    const set = new Set<string>()
    for (const emp of report.data?.employees || []) {
      if (emp.department) set.add(emp.department)
    }
    return [...set].sort()
  }, [report.data?.employees])

  const allRows: ProgressRow[] = useMemo(() => {
    const flat: ProgressRow[] = []
    for (const emp of report.data?.employees || []) {
      const employeeName = `${emp.firstName} ${emp.lastName}`.trim()
      if (!emp.courses.length) {
        if (showUnassigned) {
          flat.push({
            ...emp,
            rowKey: `${emp.employeeId}-none`,
            employeeName,
            courseId: '',
            courseTitle: '—',
            status: 'NOT_STARTED',
            progressPercent: 0,
            totalLessons: 0,
            completedLessons: 0,
          })
        }
        continue
      }
      for (const course of emp.courses) {
        flat.push({
          ...emp,
          ...course,
          rowKey: `${emp.employeeId}-${course.courseId}`,
          employeeName,
        })
      }
    }
    return flat
  }, [report.data?.employees, showUnassigned])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return allRows.filter((r) => {
      const matchesSearch = !q || [
        r.employeeName,
        r.email,
        r.employeeCode,
        r.courseTitle,
        r.department,
      ].some((v) => v?.toLowerCase().includes(q))
      const matchesDept = !deptFilter || r.department === deptFilter
      const matchesStatus = !statusFilter || r.status === statusFilter
      return matchesSearch && matchesDept && matchesStatus
    })
  }, [allRows, search, deptFilter, statusFilter])

  const summary = report.data?.summary

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Training"
        description="Employee course assignments and learning progress"
        action={
          <Button variant="secondary" onClick={() => navigate('/training/manage')}>Manage Courses</Button>
        }
      />

      {report.isLoading ? <LoadingState /> : report.isError ? (
        <Card>
          <CardBody>
            <EmptyState title="Could not load training progress" description={getErrorMessage(report.error)} />
          </CardBody>
        </Card>
      ) : (
        <>
          {summary ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Card><CardBody><p className="text-xs text-slate-500">Employees</p><p className="text-2xl font-semibold">{summary.employeeCount}</p></CardBody></Card>
              <Card><CardBody><p className="text-xs text-slate-500">Active courses</p><p className="text-2xl font-semibold">{summary.courseCount}</p></CardBody></Card>
              <Card><CardBody><p className="text-xs text-slate-500">Completed</p><p className="text-2xl font-semibold text-emerald-600">{summary.completedAssignments}</p></CardBody></Card>
              <Card><CardBody><p className="text-xs text-slate-500">In progress</p><p className="text-2xl font-semibold text-blue-600">{summary.inProgressAssignments}</p></CardBody></Card>
            </div>
          ) : null}

          <Card>
            <CardBody className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Search">
                  <Input
                    placeholder="Name, email, course, department…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </Field>
                <Field label="Department">
                  <Select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}>
                    <option value="">All departments</option>
                    {departments.map((d) => <option key={d} value={d}>{d}</option>)}
                  </Select>
                </Field>
                <Field label="Status">
                  <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                    <option value="">All statuses</option>
                    <option value="NOT_STARTED">Not started</option>
                    <option value="IN_PROGRESS">In progress</option>
                    <option value="COMPLETED">Completed</option>
                  </Select>
                </Field>
              </div>

              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={showUnassigned}
                  onChange={(e) => setShowUnassigned(e.target.checked)}
                />
                Show employees with no assigned courses
              </label>

              <DataTable
                rows={rows}
                emptyTitle={allRows.length ? 'No records match your filters' : 'No course assignments yet — assign departments when creating courses'}
                columns={[
                  {
                    key: 'employee',
                    header: 'Employee',
                    render: (r) => (
                      <div>
                        <div className="font-medium">{r.employeeName}</div>
                        <div className="text-xs text-slate-500">{r.employeeCode || r.email}</div>
                      </div>
                    ),
                  },
                  { key: 'department', header: 'Department', render: (r) => r.department || '—' },
                  { key: 'course', header: 'Course', render: (r) => r.courseTitle },
                  {
                    key: 'progress',
                    header: 'Progress',
                    render: (r) => r.courseId ? (
                      <div className="min-w-[120px]">
                        <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                          <span>{r.completedLessons}/{r.totalLessons} lessons</span>
                          <span>{r.progressPercent}%</span>
                        </div>
                        <div className="h-2 rounded-full bg-slate-100">
                          <div className="h-2 rounded-full bg-primary" style={{ width: `${r.progressPercent}%` }} />
                        </div>
                      </div>
                    ) : '—',
                  },
                  {
                    key: 'status',
                    header: 'Status',
                    render: (r) => (
                      <Badge status={statusBadge(r.status)}>
                        {formatStatus(r.status.toLowerCase())}
                      </Badge>
                    ),
                  },
                ]}
              />
            </CardBody>
          </Card>
        </>
      )}
    </div>
  )
}
