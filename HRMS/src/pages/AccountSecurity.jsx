import { useState } from 'react';
import { ShieldCheck, ShieldOff, Smartphone, Copy } from 'lucide-react';
import toast from 'react-hot-toast';
import { PageHeader, Card, CardHeader, Button, Input, Badge } from '../components/ui';
import { useAuthStore } from '../store/authStore';
import {
  startTwoFactorEnrollApi,
  confirmTwoFactorApi,
  disableTwoFactorApi,
  fetchMeApi,
} from '../api/auth.api';

const onlyDigits = (v) => v.replace(/\D/g, '').slice(0, 6);

/** Groups the base32 key in fours so it can be typed into an app by hand. */
const formatKey = (key) => (key || '').replace(/(.{4})/g, '$1 ').trim();

export default function AccountSecurity() {
  const user = useAuthStore((s) => s.user);
  const setAuthenticatedUser = useAuthStore((s) => s.setAuthenticatedUser);
  const enabled = Boolean(user?.twoFaEnabled);

  // idle → setup (QR shown, waiting for first code) ; disabling → code prompt to turn off
  const [mode, setMode] = useState('idle');
  const [enrollment, setEnrollment] = useState(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refreshUser = async () => {
    const fresh = await fetchMeApi();
    if (fresh) setAuthenticatedUser(fresh);
  };

  const reset = () => {
    setMode('idle');
    setEnrollment(null);
    setCode('');
    setError('');
  };

  const beginSetup = async () => {
    setBusy(true);
    setError('');
    try {
      setEnrollment(await startTwoFactorEnrollApi());
      setMode('setup');
    } catch (err) {
      toast.error(err.message || 'Could not start two-factor setup');
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async (e) => {
    e?.preventDefault();
    if (code.length !== 6) {
      setError('Enter the 6-digit code from your authenticator app');
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (mode === 'setup') {
        await confirmTwoFactorApi(code);
        toast.success('Two-factor authentication is on');
      } else {
        await disableTwoFactorApi(code);
        toast.success('Two-factor authentication is off');
      }
      await refreshUser();
      reset();
    } catch (err) {
      setError(err.message || 'That code did not work. Try the newest code in your app.');
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  const copyKey = async () => {
    try {
      await navigator.clipboard.writeText(enrollment?.manualEntryKey || '');
      toast.success('Key copied');
    } catch {
      toast.error('Could not copy — select the key and copy it manually');
    }
  };

  const codeForm = (submitLabel, variant) => (
    <form onSubmit={submitCode} className="flex flex-col sm:flex-row sm:items-end gap-3">
      <Input
        label="6-digit code"
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus
        placeholder="123456"
        value={code}
        error={error}
        onChange={(e) => setCode(onlyDigits(e.target.value))}
        containerClass="sm:w-48"
        className="tracking-[0.3em] font-mono"
      />
      <div className="flex gap-2">
        <Button type="submit" variant={variant} loading={busy} disabled={code.length !== 6}>{submitLabel}</Button>
        <Button type="button" variant="outline" onClick={reset} disabled={busy}>Cancel</Button>
      </div>
    </form>
  );

  return (
    <div className="space-y-6 animate-fade-in max-w-3xl">
      <PageHeader title="Account Security" subtitle="Protect your sign-in with a code from your phone" />

      <Card>
        <CardHeader
          title="Two-factor authentication"
          subtitle="After your password, you'll also enter a 6-digit code from an authenticator app such as Google Authenticator, Microsoft Authenticator or Authy."
          action={enabled
            ? <Badge tone="success" dot>On</Badge>
            : <Badge tone="neutral" dot>Off</Badge>}
        />
        <div className="p-5 pt-3 space-y-5">
          {mode === 'idle' && !enabled && (
            <Button icon={ShieldCheck} onClick={beginSetup} loading={busy}>Set up two-factor authentication</Button>
          )}

          {mode === 'idle' && enabled && (
            <div className="space-y-3">
              <p className="text-sm text-fg-muted">Your account asks for a code from your authenticator app every time you sign in.</p>
              <Button icon={ShieldOff} variant="outline" onClick={() => { setMode('disabling'); setError(''); }}>
                Turn off two-factor authentication
              </Button>
            </div>
          )}

          {mode === 'setup' && enrollment && (
            <div className="space-y-5">
              <ol className="space-y-5">
                <li className="flex flex-col sm:flex-row gap-5">
                  <div className="shrink-0 rounded-xl bg-white p-2 border border-border self-start">
                    <img src={enrollment.qrDataUri} alt="QR code for your authenticator app" width={180} height={180} />
                  </div>
                  <div className="space-y-2 text-sm">
                    <p className="font-medium text-fg flex items-center gap-2"><Smartphone className="h-4 w-4" /> 1. Scan this QR code</p>
                    <p className="text-fg-muted">Open your authenticator app, add an account, and scan the code.</p>
                    <p className="text-fg-muted pt-2">Can't scan it? Enter this key instead:</p>
                    <div className="flex items-center gap-2">
                      <code className="rounded-lg bg-muted px-3 py-2 font-mono text-xs text-fg break-all select-all">{formatKey(enrollment.manualEntryKey)}</code>
                      <Button type="button" size="sm" variant="ghost" icon={Copy} onClick={copyKey} aria-label="Copy key" />
                    </div>
                  </div>
                </li>
                <li className="space-y-3">
                  <p className="text-sm font-medium text-fg">2. Enter the code your app shows</p>
                  {codeForm('Turn on', 'primary')}
                </li>
              </ol>
            </div>
          )}

          {mode === 'disabling' && (
            <div className="space-y-3">
              <p className="text-sm text-fg-muted">Enter a current code from your authenticator app to turn two-factor authentication off.</p>
              {codeForm('Turn off', 'danger')}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
