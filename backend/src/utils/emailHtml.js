/**
 * Rich text from the in-app editor (announcements are saved as HTML, e.g.
 * `<p data-pm-slice="1 1 []">Dear Team,</p>`) → HTML that is safe to put in
 * an email and renders the same in every mail client.
 *
 * Allow-list only: the formatting the editor can produce survives (with
 * inline styles, since mail clients ignore stylesheets); every attribute is
 * dropped except a link's http(s)/mailto href; script/style/iframe and the
 * like are removed with their content; any other tag is removed but its
 * text kept. Plain text (older announcements) is escaped, keeping newlines.
 *
 * Escaping the whole thing instead — what the template used to do — is safe
 * but shows the tags to the reader as literal text.
 */

const INK = '#0F172A';
const MUTED = '#475569';
const LINK = '#2563EB';

const BLOCK_STYLE = {
  p: 'margin:0 0 12px;',
  div: 'margin:0 0 12px;',
  h1: `margin:18px 0 8px;font-size:20px;line-height:1.35;font-weight:700;color:${INK};`,
  h2: `margin:16px 0 8px;font-size:18px;line-height:1.35;font-weight:700;color:${INK};`,
  h3: `margin:14px 0 6px;font-size:16px;line-height:1.4;font-weight:600;color:${INK};`,
  h4: `margin:12px 0 6px;font-size:15px;line-height:1.4;font-weight:600;color:${INK};`,
  ul: 'margin:0 0 12px;padding-left:22px;',
  ol: 'margin:0 0 12px;padding-left:22px;',
  li: 'margin:0 0 4px;',
  blockquote: `margin:0 0 12px;padding:4px 0 4px 12px;border-left:3px solid #CBD5E1;color:${MUTED};`,
};
const INLINE = new Set(['strong', 'b', 'em', 'i', 'u', 's', 'strike', 'span', 'code']);
const VOID = new Set(['br']);
const DROP_WITH_CONTENT = new Set(['script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template', 'svg', 'math', 'head', 'title', 'textarea', 'select', 'button']);

const escapeText = (s) => String(s)
  // Keep the entities the editor already produced (&nbsp; &amp; &#39; …);
  // escape any bare & so it cannot start one.
  .replace(/&(?!(#\d{1,7}|#x[0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});)/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

const decodeBasicEntities = (s) => String(s)
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&amp;/g, '&');

const safeHref = (attrs) => {
  const m = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(attrs || '');
  if (!m) return null;
  // Decode before checking, so "&#106;avascript:" cannot slip through.
  const href = decodeBasicEntities(m[1] ?? m[2] ?? m[3] ?? '').trim().replace(/[\u0000-\u001F\u007F\s]+/g, '');
  return /^(https?:\/\/|mailto:)/i.test(href) ? href : null;
};

const plainTextToHtml = (text) => String(text)
  .split(/\n{2,}/)
  .map((para) => `<p style="${BLOCK_STYLE.p}">${escapeText(para).replace(/\n/g, '<br/>')}</p>`)
  .join('');

const TOKEN = /<!--[\s\S]*?-->|<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>|<|[^<]+/g;

const toEmailSafeHtml = (input) => {
  const source = String(input ?? '').trim();
  if (!source) return '';
  // HTML only if it contains a tag the editor actually produces — plain text
  // like "bring <your laptop>" stays text.
  if (!/<\/?(p|br|div|span|strong|b|em|i|u|s|strike|code|ul|ol|li|h[1-6]|a|blockquote)\b[^>]*>/i.test(source)) {
    return plainTextToHtml(source);
  }

  let out = '';
  // Each entry: the source tag name (what a closing tag names) and the tag
  // actually written (an unsafe link is written as a span).
  const open = [];
  let dropDepth = 0;
  let dropTag = null;
  for (const match of source.matchAll(TOKEN)) {
    const [token, rawName, attrs] = match;
    if (token.startsWith('<!--')) continue;
    if (!rawName) {
      if (!dropDepth) out += token === '<' ? '&lt;' : escapeText(token);
      continue;
    }
    const name = rawName.toLowerCase();
    const closing = token.startsWith('</');
    const selfClosing = /\/\s*>$/.test(token);

    if (dropDepth) {
      if (name === dropTag) dropDepth += closing ? -1 : (selfClosing ? 0 : 1);
      if (!dropDepth) dropTag = null;
      continue;
    }
    if (DROP_WITH_CONTENT.has(name)) {
      if (!closing && !selfClosing) { dropDepth = 1; dropTag = name; }
      continue;
    }

    if (VOID.has(name)) { if (!closing) out += '<br/>'; continue; }

    const isBlock = Object.prototype.hasOwnProperty.call(BLOCK_STYLE, name);
    const isLink = name === 'a';
    if (!isBlock && !INLINE.has(name) && !isLink) continue; // unknown tag: keep its text only

    if (closing) {
      const at = open.map((e) => e.source).lastIndexOf(name);
      if (at === -1) continue;
      while (open.length > at) out += `</${open.pop().written}>`;
      continue;
    }
    if (selfClosing) continue;

    if (isLink) {
      const href = safeHref(attrs);
      if (href) {
        out += `<a href="${escapeText(href).replace(/"/g, '&quot;')}" target="_blank" rel="noopener noreferrer" style="color:${LINK};text-decoration:underline;">`;
        open.push({ source: 'a', written: 'a' });
      } else {
        out += '<span>';
        open.push({ source: 'a', written: 'span' });
      }
      continue;
    }
    const tag = name === 'b' ? 'strong' : name === 'i' ? 'em' : name === 'strike' ? 's' : name;
    out += isBlock ? `<${tag} style="${BLOCK_STYLE[name]}">` : `<${tag}>`;
    open.push({ source: name, written: tag });
  }
  while (open.length) out += `</${open.pop().written}>`;
  return out;
};

/** Readable plain text from the same input — for the email's text part and previews. */
const toPlainText = (input) => decodeBasicEntities(
  String(input ?? '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|blockquote)>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '• ')
    .replace(/<[^>]*>/g, ''),
).replace(/ /g, ' ').replace(/\n{3,}/g, '\n\n').trim();

module.exports = { toEmailSafeHtml, toPlainText };
