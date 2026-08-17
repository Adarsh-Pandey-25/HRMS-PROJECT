export const REGULARIZATION_SUBJECT_PREFIX = 'Attendance correction';

export function isRegularizationTicket(ticket) {
  if (!ticket) return false;
  const subject = String(ticket.subject || '').toLowerCase();
  return ticket.category === 'hr' && subject.startsWith(REGULARIZATION_SUBJECT_PREFIX.toLowerCase());
}

export function buildRegularizationSubject(date) {
  return `${REGULARIZATION_SUBJECT_PREFIX} — ${date}`;
}

export function buildRegularizationDescription({ requestedCheckIn, requestedCheckOut, reason }) {
  return [
    `Requested check-in: ${requestedCheckIn}`,
    `Requested check-out: ${requestedCheckOut || '—'}`,
    `Reason: ${reason}`,
  ].join('\n');
}

export function parseRegularizationTicket(ticket) {
  if (!isRegularizationTicket(ticket)) return null;

  const subjectMatch = String(ticket.subject || '').match(/Attendance correction —\s*(.+)/i);
  const date = subjectMatch?.[1]?.trim() || '';
  const desc = String(ticket.description || '');

  const checkInMatch = desc.match(/Requested check-in:\s*(.+)/i);
  const checkOutMatch = desc.match(/Requested check-out:\s*(.+)/i);
  const reasonMatch = desc.match(/Reason:\s*([\s\S]+)/i);

  let requestedCheckOut = checkOutMatch?.[1]?.trim() || '';
  if (requestedCheckOut === '—') requestedCheckOut = '';

  return {
    ticketId: ticket.id,
    employeeId: ticket.raisedBy,
    date,
    requestedCheckIn: checkInMatch?.[1]?.trim() || '',
    requestedCheckOut,
    reason: reasonMatch?.[1]?.trim() || '',
    status: ticket.status,
    createdAt: ticket.createdAt,
  };
}

/** Combine YYYY-MM-DD + HH:mm into ISO string in IST. */
export function toIstIso(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null;
  const normalized = timeStr.length === 5 ? timeStr : timeStr.slice(0, 5);
  return `${dateStr}T${normalized}:00+05:30`;
}
