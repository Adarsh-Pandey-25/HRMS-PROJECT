import { differenceInDays, addDays } from 'date-fns';

/** True if the employee joined within `windowDays` of today (default 90). */
export function isNewJoiner(employee, windowDays = 90) {
  if (!employee?.joinDate) return false;
  return differenceInDays(new Date(), new Date(employee.joinDate)) <= windowDays;
}

/** ISO date string by which a new joiner must finish mandatory training. */
export function newJoinerDeadline(employee, deadlineDays = 30) {
  if (!employee?.joinDate) return null;
  return addDays(new Date(employee.joinDate), deadlineDays).toISOString().slice(0, 10);
}

/** Whole days remaining until `deadline` (negative once overdue). */
export function daysUntil(deadline) {
  if (!deadline) return null;
  return differenceInDays(new Date(deadline), new Date());
}
