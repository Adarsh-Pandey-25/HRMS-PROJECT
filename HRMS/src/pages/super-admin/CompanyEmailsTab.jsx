import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, ScrollText } from 'lucide-react';
import toast from 'react-hot-toast';
import { Card, CardHeader, Badge, Skeleton, Toggle, EmptyState } from '../../components/ui';
import {
  getCompanyEmailPreferencesApi, setCompanyEmailPreferenceApi, getEmailCatalogApi,
} from '../../api/superAdmin.api';

const LOCK_TITLES = {
  credentials: 'Login credentials',
  security: 'Account security',
  billing: 'Billing',
};

/**
 * Per-company email switches. Each switch governs one or more emails; the
 * server skips a switched-off email for this company and records the skip
 * in the Email Log. Emails that carry credentials, security or billing
 * notices have no switch — they are listed separately so it is clear why.
 */
export function CompanyEmailsTab({ companyId }) {
  const qc = useQueryClient();
  const queryKey = ['super-admin', 'company', companyId, 'email-preferences'];
  const { data: prefs = [], isLoading, error } = useQuery({
    queryKey,
    queryFn: () => getCompanyEmailPreferencesApi(companyId),
  });
  const { data: catalog } = useQuery({
    queryKey: ['super-admin', 'email-catalog'],
    queryFn: getEmailCatalogApi,
    staleTime: 10 * 60 * 1000,
  });
  const [busyKey, setBusyKey] = useState(null);

  const groups = useMemo(() => {
    const byGroup = new Map();
    for (const p of prefs) {
      if (!byGroup.has(p.group)) byGroup.set(p.group, []);
      byGroup.get(p.group).push(p);
    }
    return [...byGroup.entries()];
  }, [prefs]);

  // Always-sent emails that belong to a company (platform ones are not this
  // company's business), grouped by why they cannot be switched off.
  const locked = useMemo(() => {
    const byReason = new Map();
    for (const t of catalog?.emailTypes || []) {
      if (t.preference || !t.companyScoped) continue;
      if (!byReason.has(t.lock)) byReason.set(t.lock, { reason: t.lockReason, items: [] });
      byReason.get(t.lock).items.push(t);
    }
    return [...byReason.entries()];
  }, [catalog]);

  const offCount = prefs.filter((p) => !p.enabled).length;

  const toggle = async (pref) => {
    setBusyKey(pref.category);
    try {
      await setCompanyEmailPreferenceApi(companyId, pref.category, !pref.enabled);
      await qc.invalidateQueries({ queryKey });
      toast.success(`${pref.label} ${pref.enabled ? 'switched off' : 'switched on'} for this company`);
    } catch (err) {
      toast.error(err.message || 'Could not update the switch');
    } finally {
      setBusyKey(null);
    }
  };

  if (isLoading) return <Skeleton className="h-64 rounded-card" />;
  if (error) {
    return (
      <Card className="p-6">
        <EmptyState icon={ScrollText} title="Could not load email settings" message={error.message} />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-fg">Emails for this company</p>
          <p className="text-xs text-fg-subtle mt-0.5">
            {offCount === 0
              ? `All ${prefs.length} switchable emails are on.`
              : `${offCount} of ${prefs.length} switchable emails are off — they are skipped for this company and logged as skipped.`}
          </p>
        </div>
        <Link
          to={`/super-admin/email-log?company=${companyId}`}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
        >
          <ScrollText className="h-4 w-4" /> See what was actually sent
        </Link>
      </Card>

      {groups.map(([group, items]) => (
        <Card key={group}>
          <CardHeader title={group} />
          <div className="divide-y divide-border px-5 pb-2">
            {items.map((pref) => (
              <div key={pref.category} className="py-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-fg">
                      {pref.label}
                      {!pref.enabled && <Badge tone="warning" className="ml-2">Off</Badge>}
                    </p>
                    <p className="text-xs text-fg-subtle mt-0.5">{pref.description}</p>
                  </div>
                  <Toggle
                    checked={pref.enabled}
                    disabled={busyKey === pref.category}
                    onChange={() => toggle(pref)}
                  />
                </div>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {(pref.emails || []).map((e) => (
                    <li
                      key={e.key}
                      className="rounded-md bg-muted/60 px-2 py-0.5 text-[11px] text-fg-muted"
                      title={`Sent to: ${e.audienceLabel}`}
                    >
                      {e.label}
                      <span className="text-fg-subtle"> → {e.audienceLabel}</span>
                      {!e.live && <span className="text-fg-subtle italic"> · not sent by anything yet</span>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Card>
      ))}

      {locked.length > 0 && (
        <Card>
          <CardHeader
            title="Always sent"
            subtitle="These have no switch. Turning them off would lock people out or hide something the company must see."
          />
          <div className="space-y-4 px-5 pb-5">
            {locked.map(([key, { reason, items }]) => (
              <div key={key}>
                <p className="flex items-center gap-1.5 text-xs font-semibold text-fg">
                  <Lock className="h-3.5 w-3.5 text-fg-subtle" /> {LOCK_TITLES[key] || key}
                </p>
                <p className="text-xs text-fg-subtle mt-0.5">{reason}</p>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {items.map((t) => (
                    <li key={t.key} className="rounded-md bg-muted/60 px-2 py-0.5 text-[11px] text-fg-muted">
                      {t.label}<span className="text-fg-subtle"> → {t.audienceLabel}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

export default CompanyEmailsTab;
