import { useCallback, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { Download, Share, Smartphone, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { useAuthStore } from '../../store/authStore';
import { usePwaInstallStore } from '../../store/pwaInstallStore';
import { markInstallPromptSeenApi } from '../../api/auth.api';

function isStandaloneDisplay() {
  return (
    window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true
  );
}

function isIosSafari() {
  const ua = window.navigator.userAgent || '';
  const iOS = /iPad|iPhone|iPod/.test(ua)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const webkit = /WebKit/.test(ua);
  const notCriOS = !/CriOS|FxiOS|EdgiOS/.test(ua);
  return iOS && webkit && notCriOS;
}

/**
 * Item 4: this used to render an always-visible floating "Install app" chip
 * on every page, every session (sessionStorage-scoped dedup that resets on
 * tab close) — exactly the persistent-nag behavior reported as a bug. Now:
 * the banner shows prominently at most once ever, gated by the server-side
 * `hasSeenInstallPrompt` flag (survives browser data clears, unlike
 * localStorage/sessionStorage), and there is no floating chip at all after
 * that — "Install App" moves into Settings as a normal, always-available
 * manual action (see SettingsInstallAppButton below) that never re-arms
 * this banner.
 *
 * The underlying browser install mechanism itself is untouched: still the
 * real `beforeinstallprompt` deferred-prompt flow with an iOS/Android
 * "how to install" fallback guide for browsers that never fire it. Only the
 * visibility/timing logic around it changed, per the task's explicit ask.
 */
export function PwaInstallPrompt() {
  const { pathname } = useLocation();
  const isSuperAdminPortal = pathname.startsWith('/super-admin');
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const hasSeenInstallPrompt = useAuthStore((s) => s.user?.hasSeenInstallPrompt);

  const standalone = usePwaInstallStore((s) => s.standalone);
  const setStandalone = usePwaInstallStore((s) => s.setStandalone);
  const setDeferred = usePwaInstallStore((s) => s.setDeferred);
  const deferred = usePwaInstallStore((s) => s.deferred);
  const guideOpen = usePwaInstallStore((s) => s.guideOpen);
  const closeGuide = usePwaInstallStore((s) => s.closeGuide);
  const installing = usePwaInstallStore((s) => s.installing);
  const install = usePwaInstallStore((s) => s.install);

  const shouldAutoShow = isAuthenticated && !isSuperAdminPortal && !standalone && hasSeenInstallPrompt === false;

  useEffect(() => {
    setStandalone(isStandaloneDisplay());
  }, [setStandalone]);

  // Always capture the native prompt event (it only fires once) regardless
  // of whether the auto-banner is currently eligible to show — Settings'
  // manual "Install App" button needs it too.
  useEffect(() => {
    const onBeforeInstall = (e) => {
      e.preventDefault();
      setDeferred(e);
    };
    const onInstalled = () => {
      setDeferred(null);
      setStandalone(true);
      toast.success('HRMS installed — check your home screen or app drawer');
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, [setDeferred, setStandalone]);

  const markSeen = useCallback(() => {
    markInstallPromptSeenApi().catch(() => {});
    useAuthStore.setState((s) => (s.user ? { user: { ...s.user, hasSeenInstallPrompt: true } } : s));
  }, []);

  const dismiss = useCallback(() => {
    markSeen();
  }, [markSeen]);

  const onInstallClick = useCallback(async () => {
    await install();
    markSeen();
  }, [install, markSeen]);

  const onGuideClick = useCallback(() => {
    usePwaInstallStore.setState({ guideOpen: true });
    markSeen();
  }, [markSeen]);

  if (!shouldAutoShow) {
    return (
      <Modal
        open={guideOpen}
        onClose={closeGuide}
        title="Add HRMS to Home Screen"
        subtitle={isIosSafari() ? 'iPhone / iPad · Safari' : 'Android · Chrome'}
        size="sm"
        footer={<Button type="button" onClick={closeGuide}>Got it</Button>}
      >
        <InstallGuideSteps />
      </Modal>
    );
  }

  const canNativeInstall = Boolean(deferred);

  return (
    <>
      <div
        role="dialog"
        aria-labelledby="pwa-install-title"
        aria-describedby="pwa-install-desc"
        className="fixed inset-x-0 bottom-0 z-[60] p-4 pb-[max(1rem,env(safe-area-inset-bottom))] pointer-events-none"
      >
        <div className="pointer-events-auto mx-auto max-w-md rounded-2xl border border-border bg-card shadow-2xl animate-scale-in overflow-hidden">
          <div className="flex items-start gap-3 p-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
              <Smartphone className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <h2 id="pwa-install-title" className="text-sm font-semibold text-fg">
                  Install HRMS on this phone
                </h2>
                <button
                  type="button"
                  onClick={dismiss}
                  aria-label="Dismiss install prompt"
                  className="rounded-md p-1 text-fg-subtle hover:bg-muted hover:text-fg transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <p id="pwa-install-desc" className="mt-1 text-xs text-fg-muted leading-relaxed">
                {canNativeInstall
                  ? 'Tap Install, then confirm. Look for “HRMS” on the home screen or in the app drawer.'
                  : 'Tap How to install for steps. You can also install later from Settings.'}
              </p>
              <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={dismiss}>
                  Not now
                </Button>
                <Button
                  type="button"
                  variant={canNativeInstall ? 'primary' : 'outline'}
                  size="sm"
                  loading={installing}
                  onClick={canNativeInstall ? onInstallClick : onGuideClick}
                  icon={canNativeInstall ? Download : Share}
                >
                  {canNativeInstall ? 'Install' : 'How to install'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <Modal
        open={guideOpen}
        onClose={closeGuide}
        title="Add HRMS to Home Screen"
        subtitle={isIosSafari() ? 'iPhone / iPad · Safari' : 'Android · Chrome'}
        size="sm"
        footer={<Button type="button" onClick={closeGuide}>Got it</Button>}
      >
        <InstallGuideSteps />
      </Modal>
    </>
  );
}

function InstallGuideSteps() {
  return isIosSafari() ? (
    <ol className="space-y-3 text-sm text-fg-muted list-decimal list-inside">
      <li>Tap the <Share className="inline h-3.5 w-3.5 text-primary align-text-bottom" /> Share button at the bottom.</li>
      <li>Scroll and tap <span className="font-medium text-fg">Add to Home Screen</span>.</li>
      <li>Tap <span className="font-medium text-fg">Add</span>. Open the new <span className="font-medium text-fg">HRMS</span> icon.</li>
    </ol>
  ) : (
    <ol className="space-y-3 text-sm text-fg-muted list-decimal list-inside">
      <li>Tap the <span className="font-medium text-fg">⋮</span> menu (top-right) in Chrome.</li>
      <li>Choose <span className="font-medium text-fg">Add to Home screen</span> or <span className="font-medium text-fg">Install app</span>.</li>
      <li>Confirm. Check the <span className="font-medium text-fg">home screen</span> and the <span className="font-medium text-fg">app drawer</span> for “HRMS”.</li>
    </ol>
  );
}
