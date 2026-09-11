// htmlText — dependency-free HTML → {title, author, published_at, text, markdown}.
// Pure TypeScript (no DOM, no Deno/Node APIs). Byte-identical copies:
//   supabase/functions/_shared/htmlText.ts  and  workers/src/htmlText.ts
// It is deliberately conservative: everything inside script/style/nav/noscript/
// template/iframe/svg/head and HTML comments is dropped; the remainder is
// linearised into paragraphs. Good enough for evidence snapshots and search;
// Crawl4AI (worker) produces the richer markdown when configured.

export interface HtmlExtract {
  title: string | null;
  author: string | null;
  published_at: string | null;
  text: string;
  markdown: string;
}

const DROP_TAGS = ['script', 'style', 'nav', 'noscript', 'template', 'iframe', 'svg', 'head', 'object', 'embed'];
const BLOCK_TAGS = new Set(['p', 'div', 'section', 'article', 'main', 'header', 'footer', 'aside', 'blockquote', 'pre', 'table', 'tr', 'ul', 'ol', 'dl', 'dt', 'dd', 'figure', 'figcaption', 'hr', 'form', 'fieldset', 'address', 'details', 'summary']);

const INLINE_TAGS = new Set(['span', 'a', 'b', 'i', 'u', 'em', 'strong', 'small', 'sup', 'sub', 'mark', 'abbr', 'cite', 'q', 'time', 'code', 'label', 'font', 's', 'del', 'ins', 'wbr']);

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', trade: '™',
  hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»', middot: '·', bull: '•',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, ent: string) => {
    if (ent[0] === '#') {
      const code = ent[1] === 'x' || ent[1] === 'X' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return '';
      try { return String.fromCodePoint(code); } catch { return ''; }
    }
    return ENTITIES[ent] ?? m;
  });
}

function stripDropTags(html: string): string {
  let out = html.replace(/<!--[\s\S]*?-->/g, '');
  for (const t of DROP_TAGS) {
    out = out.replace(new RegExp(`<${t}\\b[^>]*>[\\s\\S]*?<\\/${t}\\s*>`, 'gi'), ' ');
    out = out.replace(new RegExp(`<${t}\\b[^>]*\\/?>`, 'gi'), ' ');
  }
  return out;
}

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  if (!m) return null;
  return decodeEntities(m[1] ?? m[2] ?? m[3] ?? '').trim();
}

function meta(html: string, keys: string[]): string | null {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const key of keys) {
    for (const t of tags) {
      const n = (attr(t, 'name') ?? attr(t, 'property') ?? attr(t, 'itemprop') ?? '').toLowerCase();
      if (n === key.toLowerCase()) {
        const c = attr(t, 'content');
        if (c) return c;
      }
    }
  }
  return null;
}

function collapse(s: string): string {
  return s.replace(/[ \t\f\v ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function safeHref(href: string | null): string | null {
  if (!href) return null;
  const h = href.trim();
  if (!/^https?:\/\//i.test(h)) return null;
  if (/[\s<>()]/.test(h)) return null;
  return h;
}

function toIso(v: string | null): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Convert an HTML body into simplified markdown: headings, paragraphs, lists, links, table rows. */
function toMarkdown(body: string): string {
  let s = body;
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<hr\s*\/?>/gi, '\n\n---\n\n');
  s = s.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi, (_m, lvl: string, inner: string) => `\n\n${'#'.repeat(Number(lvl))} ${inline(inner)}\n\n`);
  s = s.replace(/<li\b[^>]*>([\s\S]*?)<\/li\s*>/gi, (_m, inner: string) => `\n- ${inline(inner)}`);
  s = s.replace(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)\s*>/gi, (_m, inner: string) => ` ${inline(inner)} |`);
  s = s.replace(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi, (_m, inner: string) => `\n|${inner.replace(/<[^>]+>/g, '')}`);
  s = s.replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote\s*>/gi, (_m, inner: string) => `\n\n> ${inline(inner)}\n\n`);
  s = s.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre\s*>/gi, (_m, inner: string) => `\n\n\`\`\`\n${decodeEntities(inner.replace(/<[^>]+>/g, ''))}\n\`\`\`\n\n`);
  s = s.replace(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi, (_m, attrs: string, inner: string) => {
    const text = inline(inner);
    const href = safeHref(attr(`<a ${attrs}>`, 'href'));
    return href && text ? `[${text}](${href})` : text;
  });
  s = s.replace(/<(?:strong|b)\b[^>]*>([\s\S]*?)<\/(?:strong|b)\s*>/gi, (_m, inner: string) => `**${inline(inner)}**`);
  s = s.replace(/<(?:em|i)\b[^>]*>([\s\S]*?)<\/(?:em|i)\s*>/gi, (_m, inner: string) => `_${inline(inner)}_`);
  s = s.replace(/<\/?([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*>/g, (_m, tag: string) => {
    const t = tag.toLowerCase();
    return BLOCK_TAGS.has(t) ? '\n\n' : INLINE_TAGS.has(t) ? '' : ' ';
  });
  return collapse(decodeEntities(s));
}

function inline(inner: string): string {
  return collapse(decodeEntities(inner.replace(/<\/?([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*>/g, (_m, tag: string) => (INLINE_TAGS.has(tag.toLowerCase()) ? '' : ' ')))).replace(/\n+/g, ' ').trim();
}

/** Plain readable text: block tags become paragraph breaks, inline tags vanish. */
function toText(body: string): string {
  let s = body.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/?([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*>/g, (_m, tag: string) => {
    const t = tag.toLowerCase();
    return BLOCK_TAGS.has(t) || /^h[1-6]$/.test(t) || t === 'li' ? '\n' : INLINE_TAGS.has(t) ? '' : ' ';
  });
  return collapse(decodeEntities(s));
}

export function extractHtml(html: string): HtmlExtract {
  const src = html ?? '';
  const titleTag = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(src);
  const title =
    meta(src, ['og:title', 'twitter:title']) ??
    (titleTag ? collapse(decodeEntities(titleTag[1].replace(/<[^>]+>/g, ' '))).replace(/\n+/g, ' ') : null) ??
    null;
  const author = meta(src, ['author', 'article:author', 'dc.creator', 'dcterms.creator', 'parsely-author', 'twitter:creator']);
  const published = toIso(meta(src, ['article:published_time', 'datePublished', 'date', 'dc.date', 'dcterms.date', 'pubdate', 'publish-date', 'parsely-pub-date', 'og:updated_time']));
  const bodyMatch = /<body\b[^>]*>([\s\S]*?)<\/body\s*>/i.exec(src);
  const body = stripDropTags(bodyMatch ? bodyMatch[1] : src);
  const text = toText(body);
  const markdown = toMarkdown(body);
  return { title: title || null, author: author || null, published_at: published, text, markdown };
}
