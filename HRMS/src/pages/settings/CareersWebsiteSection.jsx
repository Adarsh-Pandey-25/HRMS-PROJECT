import { useEffect, useState } from 'react';
import { Copy, Check, KeyRound, Plus, X, Globe, ShieldCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  Card, CardHeader, Button, Input, Select, Textarea, Toggle, Badge, ConfirmDialog, Skeleton,
} from '../../components/ui';
import { useCareersSite, useCareersSiteMutations } from '../../hooks/useModules';

const MODE_OPTIONS = [
  { value: 'required', label: 'Required' },
  { value: 'optional', label: 'Optional' },
  { value: 'hidden', label: "Don't ask" },
];

function CopyField({ label, value }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Could not copy. Select it and copy it by hand.');
    }
  };
  return (
    <div>
      <p className="text-xs font-medium text-fg-muted mb-1.5">{label}</p>
      <div className="flex items-center gap-2">
        <code className="flex-1 min-w-0 truncate rounded-input border border-border bg-muted/40 px-3 py-2 text-xs font-mono text-fg" title={value}>{value}</code>
        <Button size="sm" variant="outline" icon={copied ? Check : Copy} onClick={copy}>{copied ? 'Copied' : 'Copy'}</Button>
      </div>
    </div>
  );
}

const formOf = (data) => ({
  enabled: Boolean(data.enabled),
  allowedOrigins: data.allowedOrigins || [],
  formFields: data.formFields || {},
  consentText: data.consentText || '',
  dailyLimit: String(data.dailyLimit || 200),
});

/**
 * Settings → Recruitment → Careers website (Careers API): the company's own
 * website shows the jobs marked "Show on website" and sends applications
 * into Candidates. Here HR switches it on, lists the website addresses
 * allowed to use the key, copies the key, and chooses the form's fields.
 */
export function CareersWebsiteCard() {
  const { data, isLoading, error } = useCareersSite();
  const { save, rotateKey } = useCareersSiteMutations();
  const [form, setForm] = useState(null);
  const [newOrigin, setNewOrigin] = useState('');
  const [confirmKey, setConfirmKey] = useState(false);

  useEffect(() => {
    if (data?.available) setForm(formOf(data));
  }, [data]);

  if (isLoading) return <Skeleton className="h-64 w-full rounded-card" />;
  if (error) {
    return (
      <Card>
        <CardHeader title="Careers website" />
        <p className="px-5 pb-5 text-sm text-fg-subtle">{error.message || 'Could not load the careers website settings.'}</p>
      </Card>
    );
  }
  if (!data?.available) {
    return (
      <Card>
        <CardHeader title="Careers website" subtitle="Show your jobs on your own website and receive applications here." />
        <p className="px-5 pb-5 text-sm text-fg-muted">
          To use this, run <span className="font-mono text-xs">{data?.sqlFile || '20261126_careers_api.sql'}</span> in Supabase once.
        </p>
      </Card>
    );
  }
  if (!form) return null;

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const dirty = JSON.stringify(form) !== JSON.stringify(formOf(data));

  const addOrigin = () => {
    const value = newOrigin.trim().replace(/\/+$/, '');
    if (!value) return;
    const withScheme = /^[a-z]+:\/\//i.test(value) ? value : `https://${value}`;
    if (form.allowedOrigins.includes(withScheme.toLowerCase())) {
      toast.error('That website is already in the list');
      return;
    }
    set({ allowedOrigins: [...form.allowedOrigins, withScheme.toLowerCase()] });
    setNewOrigin('');
  };

  const submit = async () => {
    const dailyLimit = Number(form.dailyLimit);
    if (!Number.isInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > 5000) {
      toast.error('The daily limit must be a whole number from 1 to 5000');
      return;
    }
    try {
      await save.mutateAsync({
        enabled: form.enabled,
        allowedOrigins: form.allowedOrigins,
        formFields: form.formFields,
        consentText: form.consentText.trim(),
        dailyLimit,
      });
      toast.success('Careers website saved');
    } catch (err) {
      toast.error(err.message || 'Could not save');
    }
  };

  const newKey = async () => {
    try {
      await rotateKey.mutateAsync();
      setConfirmKey(false);
      toast.success('New key created. Put it on your website: the old key no longer works.');
    } catch (err) {
      toast.error(err.message || 'Could not create a new key');
    }
  };

  const key = data.siteKey;
  const api = data.apiBase;

  return (
    <Card>
      <CardHeader
        title={<span className="inline-flex items-center gap-2"><Globe className="h-4 w-4" /> Careers website</span>}
        subtitle='Your own website shows the jobs marked "Show on website", and candidates who apply there appear in Candidates with everything they filled in.'
        action={<Badge tone={data.enabled ? 'success' : 'neutral'} dot>{data.enabled ? 'On' : 'Off'}</Badge>}
      />
      <div className="p-5 pt-3 space-y-6">
        <Toggle
          label="Accept applications from our website"
          hint="Needs at least one website address below."
          checked={form.enabled}
          onChange={(v) => set({ enabled: v })}
        />

        <div>
          <p className="text-xs font-medium text-fg-muted mb-1.5">Your website addresses</p>
          <p className="text-xs text-fg-subtle mb-2">
            Only pages on these websites can show your jobs and send applications. If your site opens both with and without www, add both
            (e.g. https://spaxads.com and https://www.spaxads.com).
          </p>
          <div className="flex flex-wrap gap-2 mb-2">
            {form.allowedOrigins.length === 0 ? (
              <p className="text-sm text-fg-subtle">No website added yet.</p>
            ) : form.allowedOrigins.map((origin) => (
              <Badge key={origin} tone="neutral">
                <span className="inline-flex items-center gap-1.5 font-mono">
                  {origin}
                  <button
                    type="button"
                    className="text-fg-subtle hover:text-danger"
                    aria-label={`Remove ${origin}`}
                    onClick={() => set({ allowedOrigins: form.allowedOrigins.filter((o) => o !== origin) })}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              </Badge>
            ))}
          </div>
          <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
            <Input
              containerClass="flex-1"
              placeholder="https://spaxads.com"
              value={newOrigin}
              onChange={(e) => setNewOrigin(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addOrigin(); } }}
            />
            <Button size="sm" variant="outline" icon={Plus} onClick={addOrigin}>Add website</Button>
          </div>
        </div>

        <div className="space-y-3">
          {key ? (
            <>
              <CopyField label="Careers key (goes on your website)" value={key} />
              <CopyField label="Careers API address" value={api} />
              <Button size="sm" variant="outline" icon={KeyRound} onClick={() => setConfirmKey(true)}>Create a new key</Button>
            </>
          ) : (
            <p className="text-sm text-fg-subtle">Save once to create your careers key.</p>
          )}
        </div>

        <div>
          <p className="text-xs font-medium text-fg-muted mb-1.5">Application form</p>
          <p className="text-xs text-fg-subtle mb-3">Name, email and the consent box are always on the form. Choose how the other fields are asked.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
            {Object.entries(data.fieldLabels || {}).map(([field, label]) => (
              <div key={field} className="flex items-center justify-between gap-3">
                <span className="text-sm text-fg">{label}</span>
                <Select
                  value={form.formFields[field] || 'optional'}
                  onChange={(e) => set({ formFields: { ...form.formFields, [field]: e.target.value } })}
                  options={MODE_OPTIONS}
                />
              </div>
            ))}
          </div>
        </div>

        <Textarea
          label="Consent text (the box candidates tick)"
          rows={3}
          maxLength={1000}
          placeholder={data.defaultConsentText}
          hint="Leave empty to use the text shown above in grey."
          value={form.consentText}
          onChange={(e) => set({ consentText: e.target.value })}
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
          <Input
            label="Most applications a day"
            type="number"
            min="1"
            max="5000"
            hint="Stops a flood of fake applications. Real hiring rarely needs more."
            value={form.dailyLimit}
            onChange={(e) => set({ dailyLimit: e.target.value })}
          />
          <p className="flex items-center gap-2 text-xs text-fg-subtle pb-2">
            <ShieldCheck className="h-4 w-4" />
            {data.captcha ? 'Robot check is on for every application.' : 'Robot check is off. Your server admin can switch it on (Cloudflare Turnstile keys).'}
          </p>
        </div>

        {key && (
          <div className="rounded-xl border border-border/70 bg-muted/30 p-4 text-xs text-fg-muted space-y-1.5">
            <p className="font-medium text-fg">For your web developer</p>
            <p className="font-mono break-all">GET {api}/jobs?key={key}</p>
            <p className="font-mono break-all">GET {api}/jobs/&lt;jobId&gt;?key={key}</p>
            <p className="font-mono break-all">POST {api}/jobs/&lt;jobId&gt;/apply?key={key}</p>
            <p>The full guide is in CAREERS_API.md. Only the websites listed above can use the key.</p>
          </div>
        )}

        <div className="flex justify-end gap-2">
          {dirty && <Button variant="outline" onClick={() => setForm(formOf(data))} disabled={save.isPending}>Undo</Button>}
          <Button onClick={submit} loading={save.isPending} disabled={save.isPending || (!dirty && Boolean(key))}>Save</Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmKey}
        onClose={() => setConfirmKey(false)}
        onConfirm={newKey}
        title="Create a new careers key?"
        message="The current key stops working at once, so your website shows no jobs until you put the new key on it. Do this only if you need to, for example if the key was used on a website you don't trust."
        confirmLabel="Create new key"
        tone="danger"
        loading={rotateKey.isPending}
      />
    </Card>
  );
}
