import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import api from '../../lib/api'
import { getErrorMessage } from '../../lib/errors'
import { Card, CardBody, DataTable, Input, LoadingState, PageHeader } from '../../components/ui'
import type { Setting } from '../../types'

export default function SettingsPage() {
  const qc = useQueryClient()

  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await api.get('/settings')).data,
  })

  const update = useMutation({
    mutationFn: async ({ key, value }: { key: string; value: string }) =>
      (await api.put(`/settings/${key}`, { value })).data,
    onSuccess: () => {
      toast.success('Setting updated')
      qc.invalidateQueries({ queryKey: ['settings'] })
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const rows: Setting[] = (settings.data?.data || [])
    .filter((s: Setting) => s.key !== 'monthly_reimbursement_limit')
    .map((s: Setting) => ({ ...s, id: s.key }))

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="System Settings" description="Configure application behavior (Admin only)" />

      <Card className="bg-muted/50 hover:shadow-md transition-shadow">
        <CardBody>
          {settings.isLoading ? <LoadingState /> : (
            <DataTable<Setting>
              rows={rows}
              emptyTitle="No settings found"
              columns={[
                { key: 'key', header: 'Key', render: (r) => <code className="text-xs bg-slate-100 px-2 py-1 rounded">{r.key}</code> },
                { key: 'value', header: 'Value', render: (r) => (
                  <Input
                    defaultValue={r.value}
                    onBlur={(e) => {
                      if (e.target.value !== r.value) update.mutate({ key: r.key, value: e.target.value })
                    }}
                  />
                ) },
                { key: 'description', header: 'Description', render: (r) => r.description || '—' },
              ]}
            />
          )}
        </CardBody>
      </Card>
    </div>
  )
}
