import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Card, CardHeader, Button, Badge, Toggle } from '../../components/ui';
import { getCompanyWhatsAppApi, updateCompanyWhatsAppApi } from '../../api/whatsapp.api';
import { invalidateAndRefetch } from '../../lib/queryCache';

const QUERY_KEY = ['whatsapp', 'company'];

/** Exactly the card this section showed before WhatsApp existed. */
function ComingSoonCard() {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-fg">WhatsApp Business</p>
          <p className="text-xs text-fg-subtle mt-0.5">Send attendance and approval alerts via WhatsApp</p>
        </div>
        <Button size="sm" variant="outline" disabled>
          Coming soon
        </Button>
      </div>
    </Card>
  );
}

/**
 * Settings → Integrations → WhatsApp. Until SpaxSync switches WhatsApp on
 * it is the same "Coming soon" card as before; without the add-on it says
 * so; with it, HR and admins turn WhatsApp on or off for the company and
 * choose which groups of updates go out. Each employee still connects their
 * own WhatsApp from their profile — nobody can do it for them.
 */
export function WhatsAppIntegrationCard() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(null);
  const [showGroups, setShowGroups] = useState(false);
  const { data, isLoading, isError } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: getCompanyWhatsAppApi,
    staleTime: 30_000,
    retry: false,
  });

  if (isLoading || isError || !data?.platformReady) return <ComingSoonCard />;

  if (!data.addOn) {
    return (
      <Card className="p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-fg">WhatsApp updates</p>
              <Badge tone="info">Add-on</Badge>
            </div>
            <p className="text-xs text-fg-subtle mt-0.5">
              Every SpaxSync notification, also on your employees’ WhatsApp. Ask SpaxSync to add it to your plan.
            </p>
          </div>
          <Button size="sm" variant="outline" disabled>Not on your plan</Button>
        </div>
      </Card>
    );
  }

  const save = async (key, body, message) => {
    setBusy(key);
    try {
      await updateCompanyWhatsAppApi(body);
      await invalidateAndRefetch(qc, QUERY_KEY);
      toast.success(message);
    } catch (err) {
      toast.error(err.message || 'Could not save');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader
        title="WhatsApp updates"
        subtitle="Every SpaxSync notification also goes to employees on WhatsApp — except passwords and codes, which never do."
        action={(
          <Toggle
            checked={data.enabled}
            disabled={Boolean(busy)}
            onChange={(next) => save('enabled', { enabled: next }, next ? 'WhatsApp updates on' : 'WhatsApp updates off')}
          />
        )}
      />
      <div className="p-5 pt-3 space-y-3">
        <p className="text-sm text-fg-muted">
          <span className="font-medium text-fg">{data.connectedCount}</span>{' '}
          {data.connectedCount === 1 ? 'employee has' : 'employees have'} connected their WhatsApp.
          Each person connects their own from their profile and can reply STOP at any time.
          {data.businessNumber ? ` Messages come from SpaxSync (${data.businessNumber}).` : ''}
        </p>
        {!data.enabled && (
          <p className="text-xs text-warning">WhatsApp updates are off for your company — nobody receives them.</p>
        )}
        <button
          type="button"
          onClick={() => setShowGroups((v) => !v)}
          className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          Choose which updates are sent
          {showGroups ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        {showGroups && (
          <div className="space-y-3 pt-1">
            {data.groups.map((g) => (
              <Toggle
                key={g.key}
                label={g.label}
                hint={g.marketing ? `${g.description} · billed by Meta as marketing (costs more)` : g.description}
                checked={g.enabled}
                disabled={Boolean(busy) || !data.enabled}
                onChange={(next) => save(g.key, { groups: { [g.key]: next } }, `${g.label}: ${next ? 'on' : 'off'}`)}
              />
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
