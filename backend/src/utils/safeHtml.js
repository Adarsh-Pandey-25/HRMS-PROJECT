/**
 * A job description written in SpaxSync's editor, made safe to put on a
 * company's own website (the Careers API, careers.service.js).
 *
 * The result is built, never copied: only the formatting tags below come
 * out, always without attributes (a link keeps only an http, https or mailto
 * address and opens in a new tab), every tag that is opened is closed, and
 * any other "<" or ">" becomes plain text. Scripts, styles, frames and other
 * embedded content are dropped together with what is inside them, so nothing
 * written in SpaxSync can run on the website showing it.
 */

const FORMATTING = new Set([
  'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'ul', 'ol', 'li',
  'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'code', 'hr', 'span', 'div',
]);
const EMPTY = new Set(['br', 'hr']);
const DANGEROUS = 'script|style|iframe|frame|frameset|object|embed|applet|noscript|noembed|template|svg|math|textarea|select|option|title|head|xmp|plaintext|listing';
// A dangerous element with its contents...
const DANGEROUS_BLOCK = new RegExp(`<(${DANGEROUS})\\b[\\s\\S]*?<\\/\\1\\s*>`, 'gi');
// ...or one left open: everything after it goes.
const DANGEROUS_OPEN = new RegExp(`<(${DANGEROUS})\\b[\\s\\S]*$`, 'i');
const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^<>]*)>/g;
const MAX_INPUT = 100000;

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', colon: ':', tab: '\t', newline: '\n' };

/** &#106; &#x6A; &colon; … decoded, so "&#106;avascript:" can't hide a script address. */
const decodeEntities = (value) => value.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);?/gi, (whole, body) => {
  if (body[0] === '#') {
    const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
  }
  const named = NAMED_ENTITIES[body.toLowerCase()];
  return named === undefined ? whole : named;
});

const escapeAttribute = (value) => value
  .replace(/&/g, '&amp;')
  .replace(/"/g, '&quot;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

const escapeText = (value) => value.replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The link's address when it is http, https or mailto; otherwise null. */
const safeHref = (attributes) => {
  const match = /(?:^|\s)href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i.exec(attributes);
  if (!match) return null;
  // Control characters and spaces are dropped the way browsers drop them.
  // eslint-disable-next-line no-control-regex
  const raw = decodeEntities(match[1] ?? match[2] ?? match[3] ?? '').replace(/[\u0000- \u007f]/g, '');
  if (!/^(https?:\/\/|mailto:)/i.test(raw)) return null;
  try {
    const url = new URL(raw);
    if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) return null;
    return url.href.length <= 2000 ? url.href : null;
  } catch {
    return null;
  }
};

/** Safe HTML for a job description; '' for nothing. */
const sanitizeJobHtml = (input) => {
  let html = String(input ?? '').slice(0, MAX_INPUT);
  if (!html.trim()) return '';
  html = html
    .replace(/<!--[\s\S]*?(?:-->|$)/g, '')
    .replace(/<!\[CDATA\[[\s\S]*?(?:\]\]>|$)/gi, '')
    .replace(/<![^>]*>/g, '')
    .replace(/<\?[^>]*>/g, '')
    .replace(DANGEROUS_BLOCK, '')
    .replace(DANGEROUS_OPEN, '');

  const open = [];
  let out = '';
  let last = 0;
  TAG.lastIndex = 0;
  let match;
  while ((match = TAG.exec(html))) {
    out += escapeText(html.slice(last, match.index));
    last = TAG.lastIndex;
    const closing = match[1] === '/';
    const name = match[2].toLowerCase();
    if (!FORMATTING.has(name) && name !== 'a') continue;
    if (EMPTY.has(name)) {
      if (!closing) out += `<${name}>`;
      continue;
    }
    if (!closing) {
      // A new list item or paragraph ends the one still open, as browsers do.
      if ((name === 'li' || name === 'p') && open[open.length - 1] === name) out += `</${open.pop()}>`;
      if (name === 'a') {
        const href = safeHref(match[3]);
        out += href ? `<a href="${escapeAttribute(href)}" target="_blank" rel="noopener noreferrer nofollow">` : '<a>';
      } else {
        out += `<${name}>`;
      }
      open.push(name);
      continue;
    }
    // A closing tag counts only if that tag is open; it also closes anything opened inside it.
    const at = open.lastIndexOf(name);
    if (at === -1) continue;
    while (open.length > at) out += `</${open.pop()}>`;
  }
  out += escapeText(html.slice(last));
  while (open.length) out += `</${open.pop()}>`;
  return out;
};

module.exports = { sanitizeJobHtml };
