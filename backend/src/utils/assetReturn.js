/**
 * Asset return requests.
 *
 * An employee asking to hand an asset back is a specially-tagged helpdesk
 * ticket, the same convention regularization already uses (see
 * helpdesk.controller.js's isRegularizationTicket) — `helpdesk_tickets` has
 * no metadata column, and the approval has to appear in the tickets queue
 * HR/Admin already work from, so a dedicated table would have been a second
 * queue for them to watch.
 *
 * The asset id is written into the description by the server when the
 * request is created, never typed by the employee, so approval always acts
 * on the right asset. Mirrored in HRMS/src/lib/assetReturn.js — change both.
 */

const ASSET_RETURN_CATEGORY = 'hr';
const ASSET_RETURN_SUBJECT_PREFIX = 'Asset return';
/** Machine-readable line the approval reads back. */
const ASSET_ID_LABEL = 'Asset ID';

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** True when this ticket is an asset return request rather than an ordinary one. */
const isAssetReturnTicket = (ticket) => {
  if (!ticket) return false;
  const subject = String(ticket.subject || ticket.Subject || '');
  return subject.toLowerCase().startsWith(ASSET_RETURN_SUBJECT_PREFIX.toLowerCase())
    && UUID_RE.test(String(ticket.description || ''));
};

/** The asset this return request is for, or null when it cannot be read. */
const parseAssetReturnAssetId = (ticket) => {
  const desc = String(ticket?.description || '');
  const line = desc.split(/\r?\n/).find((l) => l.toLowerCase().startsWith(`${ASSET_ID_LABEL.toLowerCase()}:`));
  const match = (line || desc).match(UUID_RE);
  return match ? match[0] : null;
};

/**
 * The ticket body for a return request. Composed server-side so the
 * `Asset ID:` line is always present and correct.
 */
const buildAssetReturnTicket = (asset, reason) => {
  const name = asset?.name || asset?.serial_number || 'asset';
  const lines = [
    'Asset return request.',
    '',
    `Asset: ${name}`,
    asset?.brand ? `Brand: ${asset.brand}` : null,
    asset?.serial_number ? `Serial: ${asset.serial_number}` : null,
    `${ASSET_ID_LABEL}: ${asset?.id}`,
    reason ? `\nReason: ${String(reason).trim()}` : null,
  ].filter(Boolean);

  return {
    subject: `${ASSET_RETURN_SUBJECT_PREFIX} — ${name}`,
    category: ASSET_RETURN_CATEGORY,
    priority: 'medium',
    description: lines.join('\n'),
  };
};

module.exports = {
  ASSET_RETURN_CATEGORY,
  ASSET_RETURN_SUBJECT_PREFIX,
  isAssetReturnTicket,
  parseAssetReturnAssetId,
  buildAssetReturnTicket,
};
