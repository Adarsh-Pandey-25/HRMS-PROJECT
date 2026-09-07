import { useQuery } from '@tanstack/react-query';
import { Server, Clock, Mail, ShieldAlert } from 'lucide-react';
import { Card, CardHeader, Badge, Skeleton, PageHeader } from '../../components/ui';
import { formatDateTime } from '../../lib/utils';
import { getSystemHealthApi, getSystemCronsApi, getSystemEmailFailuresApi, listActiveImpersonationsApi } from '../../api/superAdmin.api';

const STATUS_TONE = { healthy: 'success', degraded: 'warning', unknown: 'neutral', failed: 'danger' };
// Distinct from status — status says "is it OK", category says "how much do we trust this reading".
// Kept as separate badges so a genuinely-checked-but-degraded value is never confused with a value
// nobody actually verified.
const CATEGORY_LABEL = { verified: 'Verified live', 'best-effort': 'Best-effort', unknown: 'Unknown' };
const CATEGORY_TONE = { verified: 'success', 'best-effort': 'warning', unknown: 'neutral' };

function StatusRow({ label, status, category, note, extra }) {
  return (
    <div className="flex items-start justify-between gap-3 py-3 border-b border-border/60 last:border-0">
      <div className="min-w-0">
        <p className="text-sm font-medium text-fg">{label}</p>
        {note && <p className="text-xs text-fg-subtle mt-0.5">{note}</p>}
        {extra}
      </div>
      <div className="flex flex-col items-end gap-1 shrink-0">
        <Badge tone={STATUS_TONE[status] || 'neutral'} className="capitalize">{status}</Badge>
        {category && <Badge tone={CATEGORY_TONE[category] || 'neutral'} className="text-[10px]">{CATEGORY_LABEL[category] || category}</Badge>}
      </div>
    </div>
  );
}

export default function SystemHealth() {
  const { data: health, isLoading: healthLoading } = useQuery({
    queryKey: ['super-admin', 'system', 'health'],
    queryFn: getSystemHealthApi,
    refetchInterval: 60_000,
  });
  const { data: crons = [], isLoading: cronsLoading } = useQuery({
    queryKey: ['super-admin', 'system', 'crons'],
    queryFn: getSystemCronsApi,
    refetchInterval: 60_000,
  });
  const { data: emailFailures, isLoading: emailLoading } = useQuery({
    queryKey: ['super-admin', 'system', 'email-failures'],
    queryFn: () => getSystemEmailFailuresApi(24),
  });
  const { data: activeSessions = [] } = useQuery({
    queryKey: ['super-admin', 'system', 'impersonation-active'],
    queryFn: listActiveImpersonationsApi,
    refetchInterval: 30_000,
  });

  return (
    <div className="space-y-6 animate-fade-in max-w-5xl">
      <PageHeader title="System Health" subtitle="Every check below is either actively verified right now, or explicitly marked unknown — never assumed healthy." />

      <Card>
        <CardHeader title="Infrastructure" action={<Server className="h-4 w-4 text-fg-subtle" />} />
        <div className="px-5 pb-2">
          {healthLoading ? <Skeleton className="h-48 w-full rounded-xl" /> : (
            <>
              <StatusRow
                label="Database connection"
                status={health?.database?.status}
                category={health?.database?.category}
                note={`Live query against Supabase, ${health?.database?.latencyMs ?? '?'}ms — checked on every load`}
                extra={health?.database?.tableSanityCounts && (
                  <p className="text-xs text-fg-subtle mt-1 font-mono">
                    {Object.entries(health.database.tableSanityCounts)
                      .map(([table, c]) => `${table}: ${c.verified ? c.rowCount : 'error'}`)
                      .join('  ·  ')}
                  </p>
                )}
              />
              <StatusRow
                label="Backups (app-level)"
                status={health?.backups?.status}
                category={health?.backups?.category}
                note={health?.backups?.lastSuccessfulBackupAt
                  ? `Last successful backup: ${formatDateTime(health.backups.lastSuccessfulBackupAt)}`
                  : health?.backups?.note}
              />
              <StatusRow
                label="Supabase PITR / native backups"
                status={health?.managementApiPitr?.status}
                category={health?.managementApiPitr?.category}
                note={health?.managementApiPitr?.note}
              />
              <StatusRow
                label="Schema migrations"
                status={health?.migrations?.status}
                category={health?.migrations?.category}
                note={health?.migrations?.lastMigrationFile
                  ? `Last: ${health.migrations.lastMigrationFile} (${formatDateTime(health.migrations.lastAppliedAt)})${health.migrations.note ? ` — ${health.migrations.note}` : ''}`
                  : health?.migrations?.note}
              />
              <StatusRow
                label="App version"
                status={health?.appVersion?.status}
                category={health?.appVersion?.category}
                note={health?.appVersion?.commitHash ? `commit ${health.appVersion.commitHash.slice(0, 8)}` : (health?.appVersion?.note || `v${health?.appVersion?.version || 'unknown'}`)}
              />
              <StatusRow label="Rate limiting" status={health?.rateLimiting?.status} category={health?.rateLimiting?.category} note={health?.rateLimiting?.note} />
            </>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Scheduled jobs" subtitle="Last run per cron, from cron_run_log" action={<Clock className="h-4 w-4 text-fg-subtle" />} />
        <div className="px-5 pb-2">
          {cronsLoading ? <Skeleton className="h-48 w-full rounded-xl" /> : crons.map((c) => (
            <StatusRow
              key={c.jobName}
              label={c.jobName.replace(/_/g, ' ')}
              status={c.currentlyRunning ? 'unknown' : c.lastStatus}
              note={c.lastRunAt ? `Last run: ${formatDateTime(c.lastRunAt)}${c.lastDurationMs ? ` (${Math.round(c.lastDurationMs / 1000)}s)` : ''}` : c.note}
              extra={c.currentlyRunning ? <Badge tone="info" className="mt-1">Running now</Badge> : c.lastError ? <p className="text-xs text-danger mt-1">{c.lastError}</p> : null}
            />
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader title="Email delivery failures" subtitle={emailFailures?.scope} action={<Mail className="h-4 w-4 text-fg-subtle" />} />
        <div className="px-5 pb-5">
          {emailLoading ? <Skeleton className="h-24 w-full rounded-xl" /> : (
            <>
              <p className="text-2xl font-semibold text-fg">{emailFailures?.failureCount ?? 0}</p>
              <p className="text-sm text-fg-subtle">failed sends in the last {emailFailures?.windowHours || 24}h (billing/subscription emails only)</p>
            </>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Active impersonation sessions" subtitle={`${activeSessions.length} currently active`} action={<ShieldAlert className="h-4 w-4 text-fg-subtle" />} />
        <div className="px-5 pb-5">
          {activeSessions.length === 0 ? (
            <p className="text-sm text-fg-subtle py-4 text-center">No active impersonation sessions.</p>
          ) : (
            <div className="divide-y divide-border/60">
              {activeSessions.map((s) => (
                <div key={s.id} className="py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-fg">{s.companies?.name} — {s.employees?.firstName} {s.employees?.lastName}</p>
                    <p className="text-xs text-fg-subtle">Reason: {s.reason}</p>
                  </div>
                  <span className="text-xs text-fg-subtle shrink-0">expires {formatDateTime(s.expiresAt)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
