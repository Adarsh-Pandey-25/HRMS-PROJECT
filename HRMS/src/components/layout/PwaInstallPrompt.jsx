import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Download, Share, Smartphone, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';

const DISMISS_KEY = 'hrms-pwa-install-dismissed';
const SESSION_SHOWN_KEY = 'hrms-pwa-banner-shown';
const RESET_FLAG = 'hrms-pwa-install-v2';

/** One-time clear so phones that dismissed the first popup see it again. */
function migrateDismissStorage() {
  try {
    if (!localStorage.getItem(RESET_FLAG)) {
      localStorage.removeItem(DISMISS_KEY);
      localStorage.setItem(RESET_FLAG, '1');
    }
  } catch {
    /* ignore */
  }
}

function wasDismissedThisSession() {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

function markSessionDismissed() {
  try {
    sessionStorage.setItem(DISMISS_KEY, '1');
  } catch {
    /* ignore */
  }
}

function wasBannerShownThisSession() {
  try {
    return sessionStorage.getItem(SESSION_SHOWN_KEY) === '1';
  } catch {
    return false;
  }
}

function markBannerShown() {
  try {
    sessionStorage.setItem(SESSION_SHOWN_KEY, '1');
  } catch {
    /* ignore */
  }
}

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
 * Install banner + always-visible Install chip (when not already installed).
 * Hidden on Super Admin portal — that surface is desktop/platform-only.
 */
export function PwaInstallPrompt() {
  const { pathname } = useLocation();
  const isSuperAdminPortal = pathname.startsWith('/super-admin');

  const [standalone, setStandalone] = useState(() => (
    typeof window !== 'undefined' ? isStandaloneDisplay() : false
  ));
  const [deferred, setDeferred] = useState(null);
  const [open, setOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    migrateDismissStorage();
    setStandalone(isStandaloneDisplay());
  }, []);

  useEffect(() => {
    if (standalone) return undefined;

    let cancelled = false;
    let hasNativePrompt = false;

    const showBanner = () => {
      if (cancelled || wasDismissedThisSession() || wasBannerShownThisSession()) return;
      markBannerShown();
      setOpen(true);
    };

    const onBeforeInstall = (e) => {
      e.preventDefault();
      hasNativePrompt = true;
      setDeferred(e);
      window.setTimeout(showBanner, 800);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);

    // Always offer the banner once per tab session (even without native install event).
    const helpTimer = window.setTimeout(() => {
      if (!hasNativePrompt) showBanner();
      else showBanner();
    }, 1500);

    return () => {
      cancelled = true;
      window.clearTimeout(helpTimer);
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
    };
  }, [standalone]);

  useEffect(() => {
    const onInstalled = () => {
      setOpen(false);
      setDeferred(null);
      setStandalone(true);
      toast.success('HRMS installed — check your home screen or app drawer');
    };
    window.addEventListener('appinstalled', onInstalled);
    return () => window.removeEventListener('appinstalled', onInstalled);
  }, []);

  const dismiss = useCallback(() => {
    markSessionDismissed();
    setOpen(false);
    setGuideOpen(false);
  }, []);

  const openGuide = useCallback(() => {
    setGuideOpen(true);
  }, []);

  const reopen = useCallback(() => {
    if (deferred) setOpen(true);
    else openGuide();
  }, [deferred, openGuide]);

  const install = useCallback(async () => {
    if (!deferred) {
      openGuide();
      return;
    }
    setInstalling(true);
    try {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice?.outcome === 'accepted') {
        toast.success('Installing… look for “HRMS” on your home screen or app list');
      } else {
        openGuide();
      }
    } catch {
      openGuide();
      toast.error('Install didn’t finish — use Add to Home screen instead');
    } finally {
      setInstalling(false);
      setDeferred(null);
      setOpen(false);
    }
  }, [deferred, openGuide]);

  if (standalone || isSuperAdminPortal) return null;

  const canNativeInstall = Boolean(deferred);

  return (
    <>
      {/* Always available — survives “Not now” */}
      {!open && (
        <button
          type="button"
          onClick={reopen}
          className="fixed bottom-20 right-4 z-[60] sm:bottom-6 flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-medium text-white shadow-lg shadow-primary/30 hover:bg-primary-dark transition-colors pb-[max(0.625rem,env(safe-area-inset-bottom))]"
        >
          <Download className="h-4 w-4" />
          Install app
        </button>
      )}

      {open && (
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
                    : 'Tap How to install for steps. You can also use the Install app button anytime.'}
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
                    onClick={canNativeInstall ? install : openGuide}
                    icon={canNativeInstall ? Download : Share}
                  >
                    {canNativeInstall ? 'Install' : 'How to install'}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <Modal
        open={guideOpen}
        onClose={() => setGuideOpen(false)}
        title="Add HRMS to Home Screen"
        subtitle={isIosSafari() ? 'iPhone / iPad · Safari' : 'Android · Chrome'}
        size="sm"
        footer={(
          <Button type="button" onClick={() => setGuideOpen(false)}>
            Got it
          </Button>
        )}
      >
        {isIosSafari() ? (
          <ol className="space-y-3 text-sm text-fg-muted list-decimal list-inside">
            <li>
              Tap the <Share className="inline h-3.5 w-3.5 text-primary align-text-bottom" /> Share button at the bottom.
            </li>
            <li>
              Scroll and tap <span className="font-medium text-fg">Add to Home Screen</span>.
            </li>
            <li>
              Tap <span className="font-medium text-fg">Add</span>. Open the new <span className="font-medium text-fg">HRMS</span> icon.
            </li>
          </ol>
        ) : (
          <ol className="space-y-3 text-sm text-fg-muted list-decimal list-inside">
            <li>
              Tap the <span className="font-medium text-fg">⋮</span> menu (top-right) in Chrome.
            </li>
            <li>
              Choose <span className="font-medium text-fg">Add to Home screen</span> or <span className="font-medium text-fg">Install app</span>.
            </li>
            <li>
              Confirm. Check the <span className="font-medium text-fg">home screen</span> and the <span className="font-medium text-fg">app drawer</span> for “HRMS”.
            </li>
          </ol>
        )}
      </Modal>
    </>
  );
}
