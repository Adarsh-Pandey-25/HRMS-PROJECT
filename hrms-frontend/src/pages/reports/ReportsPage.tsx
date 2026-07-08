import { useQuery } from '@tanstack/react-query'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import api from '../../lib/api'
import { Card, CardBody, CardHeader, LoadingState, PageHeader } from '../../components/ui'

export default function ReportsPage() {
  const now = new Date()
  const month = now.getMonth() + 1
  const year = now.getFullYear()

  const report = useQuery({
    queryKey: ['reports', 'team-performance', month, year],
    queryFn: async () => (await api.get('/reports/team-performance', { params: { month, year } })).data,
  })

  const data = report.data?.data || []
  const chartData = Array.isArray(data)
    ? data.map((item: Record<string, unknown>) => {
        const emp = item.employee as { firstName?: string; lastName?: string } | undefined
        const attendance = item.attendance as { present?: number; total?: number } | undefined
        const leaves = item.leaves as { approvedDays?: number } | undefined
        const name = emp ? `${emp.firstName || ''} ${emp.lastName || ''}`.trim() : 'Employee'
        const present = Number(attendance?.present || 0)
        const total = Number(attendance?.total || 22)
        return {
          name,
          attendance: total ? Math.round((present / total) * 100) : present,
          leaves: Number(leaves?.approvedDays || 0),
        }
      })
    : []

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="Reports" description={`Team performance — ${now.toLocaleString('default', { month: 'long' })} ${year}`} />

      <Card className="bg-muted/50 hover:shadow-md transition-shadow">
        <CardHeader><div className="font-semibold text-slate-900">Team Performance</div></CardHeader>
        <CardBody>
          {report.isLoading ? <LoadingState /> : chartData.length ? (
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={70} />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="attendance" fill="hsl(var(--primary))" name="Attendance %" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="leaves" fill="#94a3b8" name="Leave Days" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="py-12 text-center text-sm text-slate-500">No report data available. Log in as a manager with team members.</div>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
