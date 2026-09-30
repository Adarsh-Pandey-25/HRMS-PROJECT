import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Mail, Lock } from 'lucide-react';
import {
  Card, CardHeader, Button, Badge, Input, Select, Skeleton, Tabs, EmptyState,
} from '../../components/ui';
import { listEmailLogApi, getEmailCatalogApi, listAllCompaniesApi } from '../../api/superAdmin.api';
import { formatDateTime, cn } from '../../lib/utils';
import { useDebounce } from '../../hooks/useDebounce';

const PAGE_SIZE = 25;

const STATUS_META = {
  sent: { label: 'Sent', tone: 'success' },
  skipped: { label: 'Skipped', tone: 'warning' },
  failed: { label: 'Failed', tone: 'danger' },
  // No SMTP configured — the email was built but not actually delivered.
  mock: { label: 'Not delivered (no SMTP)', tone: 'neutral' },
};

const SKIP_REASON = {
  disabled_for_company: 'Switched off for this company',
};

const TABS = [
  { id: 'log', label: 'Sent log', icon: Mail },
  { id: 'catalog', label: 'Which email goes where', icon: Lock },
];

/**
 * Audit view: every email the platform sent, skipped or failed to send, and
 * a reference of which email goes to whom and why. Temporary — for checking
 * the email flows while they settle.
 */
export default function SuperAdminEmailLog() {
  const [tab, setTab] = useState('log');
  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h1 className="text-xl font-semibold text-fg">Email log</h1>
        <p className="text-sm text-fg-subtle mt-0.5">
          Every email the platform sends, who it went to, and what triggered it. Subjects only — bodies are never stored.
        </p>
      </div>
      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      {tab === 'log' ? <SentLog /> : <Catalogue />}
    </div>
  );
}

function SentLog() {
  const [params, setParams] = useSearchParams();
  const companyId = params.get('company') || '';
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [recipient, setRecipient] = useState('');
  const [page, setPage] = useState(1);
  const debouncedRecipient = useDebounce(recipient, 350);

  const setCompany = (value) => {
    const next = new URLSearchParams(params);
    if (value) next.set('company', value); else next.delete('company');
    setParams(next, { replace: true });
    setPage(1);
  };

  const { data: companies = [] } = useQuery({
    queryKey: ['super-admin', 'companies', 'all'],
    queryFn: listAllCompaniesApi,
    staleTime: 5 * 60 * 1000,
  });
  const { data: catalog } = useQuery({
    queryKey: ['super-admin', 'email-catalog'],
    queryFn: getEmailCatalogApi,
    staleTime: 10 * 60 * 1000,
  });
  const { data, isLoading, error } = useQuery({
    queryKey: ['super-admin', 'email-log', { companyId, status, type, recipient: debouncedRecipient, page }],
    queryFn: () => listEmailLogApi({
      page, limit: PAGE_SIZE, companyId, status, type, recipient: debouncedRecipient,
    }),
    placeholderData: keepPreviousData,
  });

  const rows = data?.items || [];
  const total = data?.meta?.total ?? rows.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const counts = data?.meta?.statusCounts || {};

  const companyOptions = useMemo(() => [
    { value: 'platform', label: 'Platform (no company)' },
    ...companies.map((c) => ({ value: c.id, label: c.name })),
  ], [companies]);
  const typeOptions = useMemo(
    () => (catalog?.emailTypes || []).map((t) => ({ value: t.key, label: t.label })),
    [catalog],
  );

  return (
    <Card>
      <div className="p-5 space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <Select placeholder="All companies" options={companyOptions} value={companyId} onChange={(e) => setCompany(e.target.value)} className="h-9 w-52" />
          <Select placeholder="All emails" options={typeOptions} value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} className="h-9 w-56" />
          <Input
            placeholder="Recipient contains…"
            value={recipient}
            onChange={(e) => { setRecipient(e.target.value); setPage(1); }}
            containerClass="w-56"
            className="h-9"
          />
        </div>

        {/* Totals double as the status filter. */}
        <div className="flex flex-wrap gap-2">
          <StatusChip label="All" active={!status} onClick={() => { setStatus(''); setPage(1); }} />
          {Object.entries(STATUS_META).map(([key, meta]) => (
            <StatusChip
              key={key}
              label={`${meta.label} · ${counts[key] ?? 0}`}
              active={status === key}
              onClick={() => { setStatus(status === key ? '' : key); setPage(1); }}
            />
          ))}
        </div>

        {isLoading ? (
          <Skeleton className="h-60 w-full rounded-xl" />
        ) : error ? (
          <EmptyState icon={Mail} title="Could not load the email log" message={error.message} />
        ) : rows.length === 0 ? (
          <p className="text-sm text-fg-subtle py-10 text-center">No emails match these filters.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  {['When', 'Email', 'Sent to', 'Company', 'Result'].map((h) => (
                    <th key={h} className="py-2.5 pr-3 font-semibold text-fg-subtle text-xs uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const meta = STATUS_META[r.status] || { label: r.status, tone: 'neutral' };
                  return (
                    <tr key={r.id} className="border-b border-border/60 align-top">
                      <td className="py-2.5 pr-3 whitespace-nowrap text-fg-muted">{formatDateTime(r.createdAt)}</td>
                      <td className="py-2.5 pr-3">
                        <p className="font-medium text-fg">{r.emailLabel}</p>
                        {r.subject && <p className="text-xs text-fg-subtle truncate max-w-[280px]" title={r.subject}>{r.subject}</p>}
                        {r.trigger && <p className="text-[11px] text-fg-subtle mt-0.5">{r.trigger}</p>}
                      </td>
                      <td className="py-2.5 pr-3">
                        <p className="text-fg break-all">{r.recipient}</p>
                        {r.audienceLabel && <p className="text-[11px] text-fg-subtle">{r.audienceLabel}</p>}
                      </td>
                      <td className="py-2.5 pr-3 text-fg-muted">
                        {r.companyId ? (
                          <Link to={`/super-admin/companies/${r.companyId}`} className="hover:text-primary hover:underline">
                            {r.companyName || 'Unknown company'}
                          </Link>
                        ) : 'Platform'}
                      </td>
                      <td className="py-2.5 pr-3">
                        <Badge tone={meta.tone}>{meta.label}</Badge>
                        {r.skipReason && <p className="text-[11px] text-fg-subtle mt-1">{SKIP_REASON[r.skipReason] || r.skipReason}</p>}
                        {r.error && <p className="text-[11px] text-danger mt-1 max-w-[220px] break-words">{r.error}</p>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-end gap-2 text-sm">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <span className="text-fg-muted">Page {page} of {totalPages}</span>
            <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        )}
      </div>
    </Card>
  );
}

function StatusChip({ label, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-pill border px-3 py-1 text-xs font-medium transition-colors',
        active ? 'border-primary bg-primary/10 text-primary' : 'border-border text-fg-muted hover:bg-muted',
      )}
    >
      {label}
    </button>
  );
}

/** Reference: every email, who receives it, what triggers it, and whether a
 *  company can switch it off. */
function Catalogue() {
  const { data: catalog, isLoading, error } = useQuery({
    queryKey: ['super-admin', 'email-catalog'],
    queryFn: getEmailCatalogApi,
    staleTime: 10 * 60 * 1000,
  });

  if (isLoading) return <Skeleton className="h-80 rounded-card" />;
  if (error) return <EmptyState icon={Mail} title="Could not load the catalogue" message={error.message} />;

  const types = catalog?.emailTypes || [];
  const liveCount = types.filter((t) => t.live).length;

  return (
    <Card>
      <CardHeader
        title="Which email goes where"
        subtitle={`${types.length} emails · ${liveCount} currently sent by something · ${types.length - liveCount} defined but not sent by anything yet. Per-company switches live on each company's Emails tab.`}
      />
      <div className="overflow-x-auto px-5 pb-5">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              {['Email', 'Sent to', 'Triggered by', 'Can a company switch it off?'].map((h) => (
                <th key={h} className="py-2.5 pr-3 font-semibold text-fg-subtle text-xs uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {types.map((t) => (
              <tr key={t.key} className={cn('border-b border-border/60 align-top', !t.live && 'opacity-60')}>
                <td className="py-2.5 pr-3">
                  <p className="font-medium text-fg">{t.label}</p>
                  <p className="text-[11px] text-fg-subtle font-mono">{t.key}</p>
                </td>
                <td className="py-2.5 pr-3 text-fg-muted">{t.audienceLabel}</td>
                <td className="py-2.5 pr-3 text-fg-muted">
                  {t.trigger}
                  {!t.live && <Badge tone="neutral" className="ml-1.5">Not sent yet</Badge>}
                </td>
                <td className="py-2.5 pr-3">
                  {t.preference ? (
                    <span className="text-fg-muted">Yes — “{t.preferenceLabel}”</span>
                  ) : (
                    <span className="inline-flex items-start gap-1 text-fg-subtle">
                      <Lock className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                      <span>No. {t.lockReason}</span>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
