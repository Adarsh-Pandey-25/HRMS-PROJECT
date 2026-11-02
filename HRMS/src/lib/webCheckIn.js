/**
 * What a web check-in needs right now, worked out from check-context.
 * Shared by My Attendance and the dashboard so their check-in buttons cannot
 * drift apart — before this the dashboard sent neither the WFH flag nor a
 * location, and failed where My Attendance worked.
 */

/**
 * Ask for the device's location at the moment of check-in, not on page load —
 * a prompt on every visit is intrusive and gets denied reflexively. Rejects
 * with a message fit to show the user.
 */
export function requestGeolocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Location is not available in this browser.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          reject(new Error('Location access was denied. Please allow location access and try again.'));
        } else {
          reject(new Error('Could not determine your location. Please try again.'));
        }
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    );
  });
}

const OFF_MESSAGE = 'Web check-in is turned off for your company. Please use the biometric device.';

/**
 * Mirrors the server's rules (attendance.service.js checkIn), so the button
 * shows what the server will actually do.
 *
 * @param ctx        check-context response
 * @param privileged admin/HR — exempt from the office geofence, as on the server
 */
export function planWebCheckIn(ctx, { privileged = false } = {}) {
  // Permanent WFH, hybrid (web from home on any day, no request), WFH
  // approved for today — or a request still waiting, which makes the
  // check-in provisional until it is decided. Check-context works this out.
  const provisional = Boolean(ctx?.provisionalWfh);
  const isWfh = Boolean(ctx?.dailyWfhApproved || ctx?.attendanceMode === 'wfh' || provisional);
  // webCheckInAllowedToday is per employee; an older backend only sent the
  // company-wide webCheckInEnabled.
  const allowed = ctx?.webCheckInAllowedToday ?? (ctx?.webCheckInEnabled !== false);
  // The office geofence applies to office days only.
  const needsGeofence = Boolean(ctx?.gpsGeofenceOn) && !isWfh && !privileged;

  return {
    allowed,
    blockedReason: allowed ? null : (ctx?.webBlockedReason || OFF_MESSAGE),
    webMode: ctx?.webMode || (ctx?.webCheckInEnabled === false ? 'off' : 'everyone'),
    isWfh,
    provisional,
    needsSelfie: Boolean(ctx?.selfieRequired || (isWfh && ctx?.wfhProof?.requireSelfie)),
    // Check-in: the office geofence on office days, or the company's
    // "record location" rule on WFH days.
    needsLocation: needsGeofence || (isWfh && Boolean(ctx?.wfhProof?.recordLocation)),
    // Check-out only ever needs the office geofence; WFH proof is check-in only.
    needsCheckoutLocation: needsGeofence,
  };
}
