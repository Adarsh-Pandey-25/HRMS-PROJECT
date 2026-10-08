/**
 * Asset return requests — the UI half of the convention.
 *
 * An employee asking to hand an asset back is a specially-tagged helpdesk
 * ticket, so HR/Admin approve it from the tickets queue they already work
 * from. Mirrors backend/src/utils/assetReturn.js — change both.
 *
 * Approval maps onto the existing ticket statuses rather than new ones:
 * `resolved` means approved (the asset really goes back to inventory) and
 * `closed` means rejected. Regularization already maps the same way, for the
 * same reason — there is no `rejected` status, and adding one would change
 * the model for every other ticket type.
 */

const ASSET_RETURN_SUBJECT_PREFIX = 'Asset return';
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** True when this ticket is an asset return request rather than an ordinary one. */
export function isAssetReturnTicket(ticket) {
  if (!ticket) return false;
  return String(ticket.subject || '')
    .toLowerCase()
    .startsWith(ASSET_RETURN_SUBJECT_PREFIX.toLowerCase())
    && UUID_RE.test(String(ticket.description || ''));
}

/** The asset this return request is for, or null when it cannot be read. */
export function parseAssetReturnAssetId(ticket) {
  const desc = String(ticket?.description || '');
  const line = desc.split(/\r?\n/).find((l) => l.toLowerCase().startsWith('asset id:'));
  const match = (line || desc).match(UUID_RE);
  return match ? match[0] : null;
}

/** Still awaiting a decision. */
export function isReturnPending(ticket) {
  return isAssetReturnTicket(ticket) && !['resolved', 'closed'].includes(String(ticket.status || ''));
}

/**
 * What the employee should be told about their return request:
 * 'pending' | 'approved' | 'rejected', or null when there is no request.
 */
export function returnDecision(ticket) {
  if (!isAssetReturnTicket(ticket)) return null;
  const status = String(ticket.status || '');
  if (status === 'resolved') return 'approved';
  if (status === 'closed') return 'rejected';
  return 'pending';
}

export { ASSET_RETURN_SUBJECT_PREFIX };
