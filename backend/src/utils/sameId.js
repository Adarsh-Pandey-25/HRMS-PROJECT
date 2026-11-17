/**
 * IDs compared the way the database compares them.
 *
 * Postgres matches a uuid regardless of letter case, so `.eq('id', 'ABC…')`
 * finds the row stored as 'abc…'. A plain `===` between two id strings does
 * not, which is how a capitalised own id once slipped past "you can't edit
 * yourself" checks (audit #4). Compare ids with sameId(), never `===`.
 */

/** Any canonical uuid (8-4-4-4-12 hex), in any letter case. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isUuid = (value) => UUID_RE.test(String(value ?? '').trim());

/** Trimmed, lower-case string form of an id ('' for null/undefined). */
const normalizeId = (value) => (value === null || value === undefined ? '' : String(value).trim().toLowerCase());

/** True when both ids are present and equal, ignoring letter case. */
const sameId = (a, b) => {
  const left = normalizeId(a);
  return left !== '' && left === normalizeId(b);
};

module.exports = { UUID_RE, isUuid, normalizeId, sameId };
