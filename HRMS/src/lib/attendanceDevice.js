/** Detect phone/tablet browsers for App Check-in (GPS-backed mobile method). */
export function isMobileDevice() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua)) return true;
  if (navigator.maxTouchPoints > 1 && /Mobile|Tablet/i.test(ua)) return true;
  // Coarse pointer + no hover ≈ phone/tablet
  try {
    if (window.matchMedia('(pointer: coarse)').matches && window.matchMedia('(hover: none)').matches) {
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

/** Resolve which check-in channel to use from Attendance Config + device. */
export function resolveCheckInMethod(checkContext, { forceMobile = false } = {}) {
  const appOn = checkContext?.appCheckInEnabled !== false && checkContext?.methods?.app !== false;
  const webOn = checkContext?.webCheckInEnabled !== false && checkContext?.methods?.web !== false;
  const mobile = forceMobile || isMobileDevice();

  if (mobile && appOn) return 'mobile';
  if (webOn) return 'web';
  if (appOn) return 'mobile';
  return null;
}

/** Whether office IP is required for the chosen method (before WFH overrides). */
export function ipRequiredForMethod(checkContext, method) {
  if (!checkContext?.officeIpRequired) return false;
  if (method === 'mobile') return checkContext.ipRequiredForApp === true;
  return checkContext.ipRequiredForWeb !== false;
}

export function getGpsLocation({ timeoutMs = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('GPS is not available on this device/browser'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          capturedAt: new Date().toISOString(),
        });
      },
      (err) => {
        const code = err?.code;
        if (code === 1) reject(new Error('Location permission denied. Allow GPS and try again.'));
        else if (code === 2) reject(new Error('Location unavailable. Move outdoors or enable GPS.'));
        else if (code === 3) reject(new Error('Location timed out. Try again with a clearer GPS signal.'));
        else reject(new Error(err?.message || 'Could not read GPS location'));
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
    );
  });
}

export function deviceIdHint() {
  if (typeof navigator === 'undefined') return null;
  const ua = String(navigator.userAgent || '').slice(0, 120);
  return `web:${ua}`;
}
