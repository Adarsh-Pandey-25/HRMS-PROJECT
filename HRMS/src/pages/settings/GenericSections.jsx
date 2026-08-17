import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Save, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { Card, CardHeader, Input, Select, Toggle, Button, Badge } from '../../components/ui';
import { ExportButton } from '../../components/shared/ExportButton';
import { useSettingsStore } from '../../store/settingsStore';
import { useCompanyStore } from '../../store/companyStore';
import { updateSettingApi } from '../../api/settings.api';
import { fetchApiKeysApi, createApiKeyApi, revokeApiKeyApi } from '../../api/apiKeys.api';
import { exportAllCompanyData } from '../../lib/exportAllData';
import { formatDateTime } from '../../lib/utils';
import { invalidateAndRefetch } from '../../lib/queryCache';
import { useAssetCategories, useAssetMutations } from '../../hooks/useModules';

function usePersistedSettingsForm(cfg, updateStore) {
  const qc = useQueryClient();
  const [form, setForm] = useState(cfg);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setForm(cfg); }, [cfg]);

  const save = async (key, payload, successMsg) => {
    setSaving(true);
    try {
      await updateSettingApi(key, payload);
      updateStore(payload);
      await invalidateAndRefetch(qc, ['settings']);
      toast.success(successMsg);
    } catch (err) {
      toast.error(err.message || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  return { form, setForm, saving, save };
}

function SaveFooter({ onSave, saving }) {
  return (
    <div className="flex justify-end">
      <Button icon={Save} onClick={onSave} loading={saving} disabled={saving}>Save Changes</Button>
    </div>
  );
}

export function RecruitmentSettingsSection() {
  const cfg = useSettingsStore((s) => s.recruitmentConfig);
  const update = useSettingsStore((s) => s.updateRecruitmentConfig);
  const { form, setForm, saving, save } = usePersistedSettingsForm(cfg, update);
  const [newStage, setNewStage] = useState('');

  const addStage = () => {
    const name = newStage.trim();
    if (!name) return toast.error('Enter a stage name');
    if ((form.stages || []).some((s) => s.toLowerCase() === name.toLowerCase())) {
      return toast.error('That stage already exists');
    }
    setForm({ ...form, stages: [...(form.stages || []), name] });
    setNewStage('');
  };

  const removeStage = (name) => {
    setForm({ ...form, stages: (form.stages || []).filter((s) => s !== name) });
  };

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Pipeline Stages" subtitle="Used on Candidates kanban. Rejected is always available from the candidate drawer." />
        <div className="p-5 pt-3 space-y-4">
          <div className="flex flex-wrap gap-2">
            {(form.stages || []).length === 0 ? (
              <p className="text-sm text-fg-subtle">No stages yet. Add one below.</p>
            ) : (form.stages || []).map((s) => (
              <Badge key={s} tone="neutral">
                <span className="inline-flex items-center gap-1.5">
                  {s}
                  <button type="button" className="text-fg-subtle hover:text-danger" onClick={() => removeStage(s)} aria-label={`Remove ${s}`}>×</button>
                </span>
              </Badge>
            ))}
          </div>
          <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
            <div className="flex-1">
              <Input
                label="Add stage"
                placeholder="e.g. Technical"
                value={newStage}
                onChange={(e) => setNewStage(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addStage(); } }}
              />
            </div>
            <Button size="sm" onClick={addStage}>Add</Button>
          </div>
        </div>
      </Card>
      <Card>
        <CardHeader title="Careers Page" />
        <div className="p-5 pt-3 space-y-4">
          <Toggle label="Public careers page enabled" checked={form.careersPageEnabled} onChange={(v) => setForm({ ...form, careersPageEnabled: v })} />
          <Input label="Careers page slug" hint={`careers.acmetech.in/${form.careersPageSlug}`} value={form.careersPageSlug} onChange={(e) => setForm({ ...form, careersPageSlug: e.target.value })} />
        </div>
      </Card>
      <Card>
        <CardHeader title="Offer Letter Template" />
        <div className="p-5 pt-3 space-y-4">
          <textarea className="w-full h-28 rounded-input border border-border bg-card px-3 py-2 text-sm text-fg" value={form.offerLetterTemplate} onChange={(e) => setForm({ ...form, offerLetterTemplate: e.target.value })} />
          <Input label="Auto-reject candidates after (days of inactivity)" type="number" value={form.autoRejectAfterDays} onChange={(e) => setForm({ ...form, autoRejectAfterDays: Number(e.target.value) })} />
        </div>
      </Card>
      <SaveFooter saving={saving} onSave={() => save('recruitment_config', form, 'Recruitment settings saved')} />
    </div>
  );
}

export function AnnouncementSettingsSection() {
  const cfg = useSettingsStore((s) => s.announcementConfig);
  const update = useSettingsStore((s) => s.updateAnnouncementConfig);
  const { form, setForm, saving, save } = usePersistedSettingsForm(cfg, update);

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Default Delivery Channels" />
        <div className="p-5 pt-3 space-y-4">
          <Toggle label="In-app (web)" hint="Always on" checked disabled />
          <Toggle label="Mobile push" checked={form.defaultChannels.mobilePush} onChange={(v) => setForm({ ...form, defaultChannels: { ...form.defaultChannels, mobilePush: v } })} />
          <Toggle label="Email" checked={form.defaultChannels.email} onChange={(v) => setForm({ ...form, defaultChannels: { ...form.defaultChannels, email: v } })} />
        </div>
      </Card>
      <Card>
        <CardHeader title="Email Subject Template" />
        <div className="p-5 pt-3 space-y-4">
          <Input value={form.emailSubjectTemplate} onChange={(e) => setForm({ ...form, emailSubjectTemplate: e.target.value })} hint="Variables: {{company}}, {{priority}}, {{title}}" />
          <Toggle label="Require admin approval before publish" checked={form.requireApproval} onChange={(v) => setForm({ ...form, requireApproval: v })} />
        </div>
      </Card>
      <SaveFooter saving={saving} onSave={() => save('announcement_config', form, 'Announcement settings saved')} />
    </div>
  );
}

export function AssetSettingsSection() {
  const cfg = useSettingsStore((s) => s.assetConfig);
  const update = useSettingsStore((s) => s.updateAssetConfig);
  const { form, setForm, saving, save } = usePersistedSettingsForm(cfg, update);
  const { data: categories = [] } = useAssetCategories();
  const { createCategory } = useAssetMutations();
  const [newCategory, setNewCategory] = useState('');
  const [adding, setAdding] = useState(false);

  const categoryNames = (Array.isArray(categories) ? categories : [])
    .map((c) => (typeof c === 'string' ? c : c?.name))
    .filter(Boolean);
  const displayCategories = categoryNames.length ? categoryNames : (form.categories || []);

  const addCategory = async () => {
    const name = newCategory.trim();
    if (!name) return toast.error('Enter a category name');
    if (displayCategories.some((c) => c.toLowerCase() === name.toLowerCase())) {
      return toast.error('That category already exists');
    }
    setAdding(true);
    try {
      await createCategory.mutateAsync({ name });
      setForm({ ...form, categories: [...displayCategories, name] });
      setNewCategory('');
      toast.success('Category added');
    } catch (err) {
      toast.error(err.message || 'Failed to add category');
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Asset Categories" subtitle="Used in Inventory, Requests, and My Assets" />
        <div className="p-5 pt-3 space-y-4">
          <div className="flex flex-wrap gap-2">
            {displayCategories.length === 0 ? (
              <p className="text-sm text-fg-subtle">No categories yet. Add one below.</p>
            ) : displayCategories.map((c) => <Badge key={c} tone="neutral">{c}</Badge>)}
          </div>
          <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
            <div className="flex-1">
              <Input
                label="Add category"
                placeholder="e.g. Headset"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCategory(); } }}
              />
            </div>
            <Button size="sm" onClick={addCategory} loading={adding} disabled={adding}>Add</Button>
          </div>
        </div>
      </Card>
      <Card>
        <CardHeader title="Depreciation" subtitle="Book value on Asset Inventory uses this method and period" />
        <div className="p-5 pt-3 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Select label="Method" options={[{ value: 'straight-line', label: 'Straight-line' }, { value: 'declining-balance', label: 'Declining balance' }]} value={form.depreciationMethod} onChange={(e) => setForm({ ...form, depreciationMethod: e.target.value })} />
          <Input label="Depreciation period (years)" type="number" min={1} value={form.depreciationYears} onChange={(e) => setForm({ ...form, depreciationYears: Number(e.target.value) })} />
        </div>
      </Card>
      <Card>
        <CardHeader title="Exit Recovery" subtitle="Assigned assets of inactive employees are flagged for recovery" />
        <div className="p-5 pt-3">
          <Input label="Reminder days before employee exit" type="number" min={0} value={form.exitRecoveryReminderDays} onChange={(e) => setForm({ ...form, exitRecoveryReminderDays: Number(e.target.value) })} />
        </div>
      </Card>
      <SaveFooter
        saving={saving}
        onSave={() => save('asset_config', {
          categories: displayCategories,
          depreciationMethod: form.depreciationMethod || 'straight-line',
          depreciationYears: Number(form.depreciationYears || 3),
          exitRecoveryReminderDays: Number(form.exitRecoveryReminderDays || 7),
        }, 'Asset settings saved')}
      />
    </div>
  );
}

export function ExpenseSettingsSection() {
  const cfg = useSettingsStore((s) => s.expenseConfig);
  const update = useSettingsStore((s) => s.updateExpenseConfig);
  const { form, setForm, saving, save } = usePersistedSettingsForm(cfg, update);

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Approval Flow" />
        <div className="p-5 pt-3 space-y-2.5">
          {[['manager-only', 'Manager approval only'], ['manager-then-hr', 'Manager → HR']].map(([val, label]) => (
            <label key={val} className="flex items-center gap-2.5 text-sm text-fg cursor-pointer">
              <input type="radio" name="expenseApprovalFlow" className="h-4 w-4 accent-primary" checked={form.approvalFlow === val} onChange={() => setForm({ ...form, approvalFlow: val })} />
              {label}
            </label>
          ))}
        </div>
      </Card>
      <Card className="p-5">
        <Input label="Require receipt for claims above (₹)" type="number" value={form.requireReceiptAbove} onChange={(e) => setForm({ ...form, requireReceiptAbove: Number(e.target.value) })} />
      </Card>
      <SaveFooter
        saving={saving}
        onSave={() => save('expense_config', {
          approvalFlow: form.approvalFlow || 'manager-then-hr',
          requireReceiptAbove: Number(form.requireReceiptAbove ?? 500),
        }, 'Expense settings saved')}
      />
    </div>
  );
}

export function TrainingSettingsSection() {
  const qc = useQueryClient();
  const cfg = useSettingsStore((s) => s.trainingConfig);
  const update = useSettingsStore((s) => s.updateTrainingConfig);
  const attendanceConfig = useSettingsStore((s) => s.attendanceConfig);
  const updateAttendance = useSettingsStore((s) => s.updateAttendanceConfig);
  const [form, setForm] = useState(cfg);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setForm(cfg); }, [cfg]);

  const onSave = async () => {
    setSaving(true);
    try {
      const payload = {
        ...cfg,
        enforceWatchOrder: Boolean(form.enforceWatchOrder),
        notifyHrOnOverdue: Boolean(form.notifyHrOnOverdue),
        certificateOnCompletion: Boolean(form.certificateOnCompletion),
      };
      const nextAttendance = {
        ...attendanceConfig,
        orderedNewJoinerVideos: payload.enforceWatchOrder,
      };
      await updateSettingApi('training_config', payload);
      await updateSettingApi('attendance_config', nextAttendance);
      update(payload);
      updateAttendance(nextAttendance);
      await invalidateAndRefetch(qc, ['settings']);
      await invalidateAndRefetch(qc, ['training']);
      await invalidateAndRefetch(qc, ['attendance']);
      toast.success('Training settings saved');
    } catch (err) {
      toast.error(err.message || 'Failed to save training settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Rules" />
        <div className="p-5 pt-3 space-y-4">
          <Toggle label="Enforce watch order" hint="Next video unlocks only after the previous is completed" checked={form.enforceWatchOrder} onChange={(v) => setForm({ ...form, enforceWatchOrder: v })} />
          <Toggle label="Notify HR when a new joiner is overdue" checked={form.notifyHrOnOverdue} onChange={(v) => setForm({ ...form, notifyHrOnOverdue: v })} />
          <Toggle label="Issue certificate on course completion" checked={form.certificateOnCompletion} onChange={(v) => setForm({ ...form, certificateOnCompletion: v })} />
        </div>
      </Card>
      <SaveFooter saving={saving} onSave={onSave} />
    </div>
  );
}

export function HelpdeskSettingsSection() {
  const cfg = useSettingsStore((s) => s.helpdeskConfig);
  const update = useSettingsStore((s) => s.updateHelpdeskConfig);
  const { form, setForm, saving, save } = usePersistedSettingsForm(cfg, update);
  const [newCategory, setNewCategory] = useState('');

  const addCategory = () => {
    const name = newCategory.trim();
    if (!name) return toast.error('Enter a category name');
    if ((form.categories || []).some((c) => c.toLowerCase() === name.toLowerCase())) {
      return toast.error('That category already exists');
    }
    setForm({ ...form, categories: [...(form.categories || []), name] });
    setNewCategory('');
  };

  const removeCategory = (name) => {
    setForm({ ...form, categories: (form.categories || []).filter((c) => c !== name) });
  };

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Categories" subtitle="Shown when raising a ticket" />
        <div className="p-5 pt-3 space-y-4">
          <div className="flex flex-wrap gap-2">
            {(form.categories || []).length === 0 ? (
              <p className="text-sm text-fg-subtle">No categories yet. Add one below.</p>
            ) : (form.categories || []).map((c) => (
              <Badge key={c} tone="neutral">
                <span className="inline-flex items-center gap-1.5">
                  {c}
                  <button type="button" className="text-fg-subtle hover:text-danger" onClick={() => removeCategory(c)} aria-label={`Remove ${c}`}>×</button>
                </span>
              </Badge>
            ))}
          </div>
          <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
            <div className="flex-1">
              <Input
                label="Add category"
                placeholder="e.g. Facilities"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCategory(); } }}
              />
            </div>
            <Button size="sm" onClick={addCategory}>Add</Button>
          </div>
        </div>
      </Card>
      <Card>
        <CardHeader title="SLA Rules" subtitle="Hours to resolution, by priority" />
        <div className="p-5 pt-3 grid grid-cols-2 sm:grid-cols-4 gap-4">
          {Object.entries(form.slaHours || {}).map(([priority, hours]) => (
            <Input key={priority} label={`${priority[0].toUpperCase()}${priority.slice(1)} (hrs)`} type="number" value={hours} onChange={(e) => setForm({ ...form, slaHours: { ...form.slaHours, [priority]: Number(e.target.value) } })} />
          ))}
        </div>
      </Card>
      <Card>
        <CardHeader title="Assignment & Escalation" />
        <div className="p-5 pt-3 space-y-4">
          <Toggle label="Auto-assignment" hint="Route new tickets to available agents automatically" checked={form.autoAssignment} onChange={(v) => setForm({ ...form, autoAssignment: v })} />
          <Input label="Escalate if unresolved after (hours)" type="number" value={form.escalateAfterHours} onChange={(e) => setForm({ ...form, escalateAfterHours: Number(e.target.value) })} />
        </div>
      </Card>
      <SaveFooter saving={saving} onSave={() => save('helpdesk_config', form, 'Helpdesk settings saved')} />
    </div>
  );
}

export function IntegrationsSection() {
  const cfg = useSettingsStore((s) => s.integrationsConfig);
  const update = useSettingsStore((s) => s.updateIntegrationsConfig);
  const { form, setForm, saving, save } = usePersistedSettingsForm(cfg, update);

  const [keys, setKeys] = useState([]);
  const [keysLoading, setKeysLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEnv, setNewEnv] = useState('live');
  const [selectedScopes, setSelectedScopes] = useState(['ping', 'attendance:write']);
  const [revealedKey, setRevealedKey] = useState(null);
  const [revokingId, setRevokingId] = useState(null);

  const SCOPE_OPTIONS = [
    { id: 'ping', label: 'Ping (test connection)' },
    { id: 'employees:read', label: 'Read employees' },
    { id: 'attendance:write', label: 'Biometric / attendance write' },
  ];

  const loadKeys = async () => {
    setKeysLoading(true);
    try {
      const rows = await fetchApiKeysApi();
      setKeys(rows);
    } catch (err) {
      toast.error(err.message || 'Could not load API keys');
    } finally {
      setKeysLoading(false);
    }
  };

  useEffect(() => {
    loadKeys();
  }, []);

  const toggleScope = (id) => {
    setSelectedScopes((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id],
    );
  };

  const createKey = async () => {
    const name = newName.trim();
    if (name.length < 2) return toast.error('Enter a name (e.g. Biometric Gate-01)');
    if (!selectedScopes.length) return toast.error('Select at least one permission');
    setCreating(true);
    try {
      const created = await createApiKeyApi({
        name,
        scopes: selectedScopes,
        environment: newEnv,
      });
      setRevealedKey(created.plaintextKey || created.plaintext_key || null);
      setNewName('');
      toast.success('API key created — copy it now; it won’t be shown again');
      await loadKeys();
    } catch (err) {
      toast.error(err.message || 'Failed to create API key');
    } finally {
      setCreating(false);
    }
  };

  const revokeKey = async (id) => {
    if (!window.confirm('Revoke this API key? Connected tools will stop working immediately.')) return;
    setRevokingId(id);
    try {
      await revokeApiKeyApi(id);
      toast.success('API key revoked');
      await loadKeys();
    } catch (err) {
      toast.error(err.message || 'Failed to revoke');
    } finally {
      setRevokingId(null);
    }
  };

  const copyKey = async () => {
    if (!revealedKey) return;
    try {
      await navigator.clipboard.writeText(revealedKey);
      toast.success('Copied to clipboard');
    } catch {
      toast.error('Could not copy — select and copy manually');
    }
  };

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="API Keys"
          subtitle="Give partners and devices a key instead of a user password. Keys are company-scoped; only a hash is stored."
        />
        <div className="p-5 pt-3 space-y-5">
          {revealedKey && (
            <div className="rounded-lg border border-warning/40 bg-warning/5 p-4 space-y-2">
              <p className="text-sm font-semibold text-fg">Copy your new key now</p>
              <p className="text-xs text-fg-muted">
                This is the only time the full key is shown. We store a hashed version only.
              </p>
              <code className="block text-xs font-mono break-all text-fg bg-surface-2 rounded-md p-3 border border-border">
                {revealedKey}
              </code>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={copyKey}>Copy key</Button>
                <Button size="sm" variant="outline" onClick={() => setRevealedKey(null)}>I’ve saved it</Button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="Key name"
              placeholder="e.g. Biometric Gate-01 or Power BI"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <Select
              label="Environment"
              value={newEnv}
              onChange={(e) => setNewEnv(e.target.value)}
              options={[
                { value: 'live', label: 'Live (hrms_live_…)' },
                { value: 'test', label: 'Test (hrms_test_…)' },
              ]}
            />
          </div>

          <div>
            <p className="text-xs font-medium text-fg-muted mb-2">Permissions (scopes)</p>
            <div className="flex flex-wrap gap-2">
              {SCOPE_OPTIONS.map((s) => {
                const on = selectedScopes.includes(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => toggleScope(s.id)}
                    className={`text-xs px-3 py-1.5 rounded-md border transition-colors ${
                      on
                        ? 'border-primary bg-primary/10 text-primary font-medium'
                        : 'border-border text-fg-muted hover:border-fg-subtle'
                    }`}
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>
          </div>

          <Button size="sm" onClick={createKey} loading={creating} disabled={creating}>
            Create API key
          </Button>

          <div className="border-t border-border pt-4">
            <p className="text-sm font-semibold text-fg mb-3">Your keys</p>
            {keysLoading ? (
              <p className="text-sm text-fg-subtle">Loading…</p>
            ) : keys.length === 0 ? (
              <p className="text-sm text-fg-subtle">No API keys yet. Create one above for a biometric device or reporting tool.</p>
            ) : (
              <ul className="space-y-3">
                {keys.map((k) => (
                  <li
                    key={k.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-lg border border-border p-3"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-fg">{k.name}</span>
                        <Badge tone={k.revokedAt ? 'danger' : k.environment === 'test' ? 'warning' : 'success'}>
                          {k.revokedAt ? 'Revoked' : k.environment || 'live'}
                        </Badge>
                      </div>
                      <p className="text-xs font-mono text-fg-subtle mt-1 truncate">
                        {k.keyPrefix}… · {(k.scopes || []).join(', ') || 'no scopes'}
                      </p>
                      {k.lastUsedAt && (
                        <p className="text-[11px] text-fg-subtle mt-0.5">
                          Last used {formatDateTime(k.lastUsedAt)}
                        </p>
                      )}
                    </div>
                    {!k.revokedAt && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-danger shrink-0"
                        loading={revokingId === k.id}
                        disabled={Boolean(revokingId)}
                        onClick={() => revokeKey(k.id)}
                      >
                        Revoke
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Card>

      {[
        { key: 'slack', label: 'Slack', hint: 'Post announcements and approvals to a Slack channel' },
        { key: 'googleCalendar', label: 'Google Calendar', hint: 'Sync holidays, leave, and interviews' },
        { key: 'whatsapp', label: 'WhatsApp Business', hint: 'Send attendance and approval alerts via WhatsApp' },
      ].map(({ key, label, hint }) => (
        <Card key={key} className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-fg">{label}</p>
              <p className="text-xs text-fg-subtle mt-0.5">{hint}</p>
            </div>
            <Button size="sm" variant="outline" disabled>
              Coming soon
            </Button>
          </div>
        </Card>
      ))}
      <Card>
        <CardHeader title="Webhooks" subtitle="Outbound webhook endpoints for custom integrations" />
        <div className="p-5 pt-3 space-y-3">
          <Input
            label="Add webhook URL"
            placeholder="https://example.com/hooks/hrms"
            value={form._newWebhook || ''}
            onChange={(e) => setForm({ ...form, _newWebhook: e.target.value })}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              const url = String(form._newWebhook || '').trim();
              if (!url) return;
              setForm({ ...form, webhooks: [...(form.webhooks || []), url], _newWebhook: '' });
            }}
          />
          {(form.webhooks || []).length === 0 ? (
            <p className="text-sm text-fg-subtle">No webhooks configured yet. Press Enter to add a URL.</p>
          ) : (
            <ul className="space-y-2">
              {form.webhooks.map((w, i) => (
                <li key={`${w}-${i}`} className="flex items-center justify-between gap-2 text-sm text-fg font-mono">
                  <span className="truncate">{w}</span>
                  <button
                    type="button"
                    className="text-xs text-danger shrink-0"
                    onClick={() => setForm({ ...form, webhooks: form.webhooks.filter((_, idx) => idx !== i) })}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
      <SaveFooter
        saving={saving}
        onSave={() => {
          const { _newWebhook, ...rest } = form;
          return save('integrations_config', {
            ...rest,
            webhooks: rest.webhooks || [],
          }, 'Integrations settings saved');
        }}
      />
    </div>
  );
}

export function SecuritySection() {
  const cfg = useSettingsStore((s) => s.securityConfig);
  const update = useSettingsStore((s) => s.updateSecurityConfig);
  const { form, setForm, saving, save } = usePersistedSettingsForm(cfg, update);

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Password Policy" subtitle="Requirements for all user account passwords" />
        <div className="p-5 pt-3 space-y-4">
          <Input label="Minimum length" type="number" value={form.passwordMinLength} onChange={(e) => setForm({ ...form, passwordMinLength: Number(e.target.value) })} />
          <Toggle label="Require a special character" checked={form.passwordRequireSpecialChar} onChange={(v) => setForm({ ...form, passwordRequireSpecialChar: v })} />
          <Toggle label="Require a number" checked={form.passwordRequireNumber} onChange={(v) => setForm({ ...form, passwordRequireNumber: v })} />
        </div>
      </Card>
      <Card>
        <CardHeader title="Session & Access" />
        <div className="p-5 pt-3 space-y-4">
          <Toggle label="Two-factor authentication" hint="Require 2FA for all admin and HR accounts" checked={form.twoFactorEnabled} onChange={(v) => setForm({ ...form, twoFactorEnabled: v })} />
          <Input label="Session timeout (minutes)" type="number" value={form.sessionTimeoutMinutes} onChange={(e) => setForm({ ...form, sessionTimeoutMinutes: Number(e.target.value) })} />
          <Toggle label="Audit log" hint="Record all admin actions for compliance" checked={form.auditLogEnabled} onChange={(v) => setForm({ ...form, auditLogEnabled: v })} />
        </div>
      </Card>
      <SaveFooter saving={saving} onSave={() => save('security_config', form, 'Security settings saved')} />
    </div>
  );
}

export function DataBackupSection() {
  const cfg = useSettingsStore((s) => s.backupConfig);
  const update = useSettingsStore((s) => s.updateBackupConfig);
  const companyName = useCompanyStore((s) => s.company.name);
  const { form, setForm, saving, save } = usePersistedSettingsForm(cfg, update);
  const [running, setRunning] = useState(false);
  const [exporting, setExporting] = useState(false);

  const runBackupNow = async () => {
    setRunning(true);
    try {
      const payload = { ...form, lastBackupAt: new Date().toISOString() };
      await updateSettingApi('backup_config', payload);
      update(payload);
      setForm(payload);
      toast.success('Backup timestamp recorded');
    } catch (err) {
      toast.error(err.message || 'Failed to record backup');
    } finally {
      setRunning(false);
    }
  };

  const handleExportAll = async (format) => {
    setExporting(true);
    try {
      return await exportAllCompanyData(format, companyName);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="Automatic Backups"
          action={(
            <Button size="sm" variant="outline" icon={RefreshCw} onClick={runBackupNow} loading={running} disabled={running}>
              Run Backup Now
            </Button>
          )}
        />
        <div className="p-5 pt-3 space-y-4">
          <Toggle label="Auto-backup enabled" checked={form.autoBackupEnabled} onChange={(v) => setForm({ ...form, autoBackupEnabled: v })} />
          <Select label="Frequency" options={[{ value: 'daily', label: 'Daily' }, { value: 'weekly', label: 'Weekly' }, { value: 'monthly', label: 'Monthly' }]} value={form.autoBackupFrequency} onChange={(e) => setForm({ ...form, autoBackupFrequency: e.target.value })} />
          <p className="text-xs text-fg-subtle">Last backup: {form.lastBackupAt ? formatDateTime(form.lastBackupAt) : 'Never'}</p>
        </div>
      </Card>
      <Card>
        <CardHeader title="Data Retention" />
        <div className="p-5 pt-3">
          <Input label="Retain data for (months)" type="number" value={form.dataRetentionMonths} onChange={(e) => setForm({ ...form, dataRetentionMonths: Number(e.target.value) })} />
        </div>
      </Card>
      <Card>
        <CardHeader title="Export" />
        <div className="p-5 pt-3">
          <ExportButton
            label="Export all data"
            size="md"
            disabled={exporting}
            loading={exporting}
            onExport={handleExportAll}
            emptyMessage="No company data available to export"
          />
        </div>
      </Card>
      <SaveFooter saving={saving} onSave={() => save('backup_config', form, 'Backup settings saved')} />
    </div>
  );
}
