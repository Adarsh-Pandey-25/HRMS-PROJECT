/**
 * Turns a day's raw biometric punches (from useDevicePunchesToday, or any
 * array of { punchTime, punchType }) into a single daily summary.
 */

const WORK_HOURS = 9;
const HALF_DAY_HOURS = WORK_HOURS / 2;
const LATE_AFTER = { hour: 9, minute: 30 };

const istTimeParts = (isoString) => {
  const [hour, minute] = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .format(new Date(isoString))
    .split(':')
    .map(Number);
  return { hour, minute };
};

const isAfterLateCutoff = (isoString) => {
  const { hour, minute } = istTimeParts(isoString);
  return hour > LATE_AFTER.hour || (hour === LATE_AFTER.hour && minute > LATE_AFTER.minute);
};

const hoursBetween = (startIso, endIso) =>
  Math.max(0, (new Date(endIso).getTime() - new Date(startIso).getTime()) / 3_600_000);

/**
 * @param {Array<{ punchTime: string, punchType: string }>} punches
 * @returns {{
 *   firstCheckin: string|null,
 *   lastCheckout: string|null,
 *   totalHoursWorked: number|null,
 *   status: 'present'|'absent'|'half_day'|'overtime',
 *   isLate: boolean,
 * }}
 */
export function summarizeDayPunches(punches = []) {
  if (!punches.length) {
    return { firstCheckin: null, lastCheckout: null, totalHoursWorked: null, status: 'absent', isLate: false };
  }

  const sorted = [...punches].sort((a, b) => new Date(a.punchTime) - new Date(b.punchTime));

  const checkins = sorted.filter((p) => p.punchType === 'checkin');
  const checkouts = sorted.filter((p) => p.punchType === 'checkout');
  const hasOvertime = sorted.some((p) => p.punchType === 'overtime_in' || p.punchType === 'overtime_out');

  // Fall back to the day's first/last scan when the device didn't tag punch
  // types cleanly — matches "first punch = check-in, last punch = check-out".
  const firstCheckin = checkins[0]?.punchTime || sorted[0].punchTime;
  const lastCheckout = checkouts.length
    ? checkouts[checkouts.length - 1].punchTime
    : (sorted.length > 1 ? sorted[sorted.length - 1].punchTime : null);

  const hasCheckin = Boolean(firstCheckin);
  const hasCheckout = Boolean(lastCheckout) && lastCheckout !== firstCheckin;

  const totalHoursWorked = hasCheckin && hasCheckout
    ? Number(hoursBetween(firstCheckin, lastCheckout).toFixed(2))
    : null;

  let status;
  if (hasOvertime) {
    status = 'overtime';
  } else if (!hasCheckout) {
    status = 'present'; // still checked in / day in progress
  } else if (totalHoursWorked < HALF_DAY_HOURS) {
    status = 'half_day';
  } else if (totalHoursWorked > WORK_HOURS) {
    status = 'overtime';
  } else {
    status = 'present';
  }

  return {
    firstCheckin,
    lastCheckout: hasCheckout ? lastCheckout : null,
    totalHoursWorked,
    status,
    isLate: hasCheckin ? isAfterLateCutoff(firstCheckin) : false,
  };
}
