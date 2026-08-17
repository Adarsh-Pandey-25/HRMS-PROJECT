import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Send, CheckCircle2, XCircle, Save } from 'lucide-react';
import toast from 'react-hot-toast';
import { Card, CardHeader, Toggle, Button } from '../../components/ui';
import { useSettingsStore } from '../../store/settingsStore';
import { updateSettingApi } from '../../api/settings.api';
import { invalidateAndRefetch } from '../../lib/queryCache';

/**
 * SMTP credentials live only in backend/.env — never stored in the browser.
 * This section persists trigger preferences (in-app / email) to the server.
 */
export function NotificationsSection() {
  const qc = useQueryClient();
  const cfg = useSettingsStore((s) => s.notificationConfig);
  const update = useSettingsStore((s) => s.updateNotificationConfig);
  const updateTrigger = useSettingsStore((s) => s.updateNotificationTrigger);
  const [emailEnabled, setEmailEnabled] = useState(Boolean(cfg.smtp?.enabled));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setEmailEnabled(Boolean(cfg.smtp?.enabled));
  }, [cfg.smtp?.enabled]);

  const save = async () => {
    const payload = {
      smtp: {
        enabled: emailEnabled,
        host: '',
        port: 587,
        username: '',
        password: '',
        fromName: '',
        fromEmail: '',
        encryption: 'TLS',
      },
      triggers: cfg.triggers || [],
    };
    setSaving(true);
    try {
      await updateSettingApi('notification_config', payload);
      update(payload);
      await invalidateAndRefetch(qc, ['settings']);
      toast.success('Notification preferences saved to server');
    } catch (err) {
      toast.error(err.message || 'Failed to save notification preferences');
    } finally {
      setSaving(false);
    }
  };

  const sendTest = () => {
    toast.error('Test email uses backend SMTP (.env). Configure SMTP_* on the server.');
  };

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="Email Provider (SMTP)"
          action={emailEnabled ? (
            <span className="flex items-center gap-1.5 text-xs font-medium text-success">
              <CheckCircle2 className="h-3.5 w-3.5" /> Preference on
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-xs font-medium text-fg-subtle">
              <XCircle className="h-3.5 w-3.5" /> Preference off
            </span>
          )}
        />
        <div className="p-5 pt-3 space-y-4">
          <p className="text-sm text-fg-muted rounded-xl border border-border bg-muted/40 px-4 py-3">
            SMTP host, username, and password are configured only on the server
            (<code className="text-xs mx-1">backend/.env</code>
            — they are never stored or shown in the browser.
          </p>
          <Toggle
            label="Prefer email for notification events"
            hint="Master switch. Per-event Email checkboxes below still apply. Delivery requires SMTP_* on the backend."
            checked={emailEnabled}
            onChange={setEmailEnabled}
          />
          <div className="flex items-center gap-3 pt-1">
            <Button variant="outline" icon={Send} onClick={sendTest}>Send Test Email</Button>
            <Button icon={Save} onClick={save} loading={saving} disabled={saving}>Save Changes</Button>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Notification Triggers" subtitle="Toggle In-App, Mobile Push, and Email per event — click Save Changes above to persist" />
        <div className="p-5 pt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="py-2 font-semibold text-fg-subtle text-xs uppercase tracking-wide">Event</th>
                {['In-App', 'Mobile', 'Email'].map((h) => (
                  <th key={h} className="py-2 font-semibold text-fg-subtle text-xs uppercase tracking-wide text-center">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cfg.triggers.map((t) => (
                <tr key={t.event} className="border-b border-border/50">
                  <td className="py-2.5 text-fg">{t.event}</td>
                  {['inApp', 'mobile', 'email'].map((ch) => (
                    <td key={ch} className="py-2.5 text-center">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-primary"
                        checked={t[ch]}
                        onChange={(e) => updateTrigger(t.event, ch, e.target.checked)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
