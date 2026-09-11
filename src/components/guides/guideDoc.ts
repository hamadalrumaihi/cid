/** The shape a written guide takes.
 *
 *  A guide is a sequence of anchor SECTIONS, each a short list of blocks. It is
 *  data, not JSX, for three reasons that matter:
 *
 *   · One renderer (GuideDocView) means every guide gets the same headings,
 *     the same table-to-card behaviour on a phone, the same focus states and
 *     the same anchor handling — accessibility is solved once rather than per
 *     guide.
 *   · The section list is derivable, so the contents rail, the in-guide
 *     search, the previous/next controls and the library's search index all
 *     read the same source and cannot disagree with the page.
 *   · A guide is reviewable as a diff. Prose changes show up as prose.
 *
 *  Inline formatting is deliberately tiny — **bold** and `code` only. A guide
 *  that needs more than that is usually a guide that needs another section. */

export type GuideBlock =
  | { kind: 'p'; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[] }
  /** Numbered steps with a bolded lead — the shape most "how do I…" answers want. */
  | { kind: 'steps'; items: { title: string; text: string }[] }
  /** A table on a wide screen; one card per row on a narrow one. */
  | { kind: 'table'; head: string[]; rows: string[][]; caption?: string }
  /** Label / value pairs — a compact fact list. */
  | { kind: 'facts'; rows: { label: string; value: string }[] }
  /** A short aside. `warn` is for "this will surprise you", not decoration. */
  | { kind: 'note'; tone?: 'info' | 'warn'; text: string }
  /** A pointer to a portal screen or another guide. */
  | { kind: 'links'; items: { to: string; label: string; hint?: string }[] }

export interface GuideDocSection {
  /** Permanent section link. Set once; a heading change must not rewrite it,
   *  because a link someone sent a colleague has to keep working. */
  anchor: string
  heading: string
  /** One line under the heading, in the contents and in search results. */
  blurb?: string
  blocks: GuideBlock[]
}

export interface GuideDoc {
  sections: readonly GuideDocSection[]
}

/* ---- derived helpers ----------------------------------------------------- */

/** Every searchable word of one section, flattened — headings, prose, table
 *  cells, link labels. Both the in-guide search and the library's search read
 *  this, so a section is findable from either the moment it is written. */
export function sectionText(s: GuideDocSection): string {
  const out: string[] = [s.heading, s.blurb ?? '']
  for (const b of s.blocks) {
    switch (b.kind) {
      case 'p': out.push(b.text); break
      case 'ul': case 'ol': out.push(...b.items); break
      case 'steps': out.push(...b.items.flatMap((i) => [i.title, i.text])); break
      case 'table': out.push(...b.head, ...b.rows.flat(), b.caption ?? ''); break
      case 'facts': out.push(...b.rows.flatMap((r) => [r.label, r.value])); break
      case 'note': out.push(b.text); break
      case 'links': out.push(...b.items.flatMap((i) => [i.label, i.hint ?? ''])); break
    }
  }
  return out.join(' ').replace(/[*`]/g, '')
}

/** Which sections match a query. A blank query matches everything — an empty
 *  box is not an empty guide. */
export function matchDocSections(doc: GuideDoc, query: string): Set<string> {
  const q = query.trim().toLowerCase()
  const all = new Set(doc.sections.map((s) => s.anchor))
  if (!q) return all
  const hit = new Set<string>()
  for (const s of doc.sections) if (sectionText(s).toLowerCase().includes(q)) hit.add(s.anchor)
  return hit
}

/** One search result inside a guide: which section matched, and the words
 *  around the match so the reader can tell whether it is the one they want. */
export interface DocSectionHit { anchor: string; heading: string; snippet: string }

/** The sections a query matches, with a window of text around each match.
 *
 *  A guide whose prose is a module is searched HERE, in the browser, against
 *  the text already in the build — not against a copy of it in the database.
 *  One text, so the search can never drift from what the guide says, and no
 *  re-seed is needed when the prose changes. The permission wall is unchanged:
 *  this only ever runs over the guides RLS already returned to this reader.
 *
 *  A blank query is no search at all rather than every section. */
export function searchDocSections(doc: GuideDoc, query: string): DocSectionHit[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const out: DocSectionHit[] = []
  for (const s of doc.sections) {
    const text = sectionText(s)
    const at = text.toLowerCase().indexOf(q)
    if (at < 0) continue
    out.push({
      anchor: s.anchor,
      heading: s.heading,
      snippet: text.slice(Math.max(0, at - 60), at + 140).trim(),
    })
  }
  return out
}

/** Rough reading time, rounded up, never below one minute. 200 words a minute
 *  is the usual prose figure; guides read slower than prose, so this is a
 *  floor rather than a promise — which is why it renders as "~N min". */
export function readMinutes(doc: GuideDoc): number {
  const words = doc.sections.reduce((n, s) => n + sectionText(s).split(/\s+/).filter(Boolean).length, 0)
  return Math.max(1, Math.round(words / 200))
}

/** The contents, in DocToc's shape, so the shared rail renders it unchanged. */
export function docHeadings(doc: GuideDoc): { id: string; text: string; level: 2 }[] {
  return doc.sections.map((s) => ({ id: s.anchor, text: s.heading, level: 2 as const }))
}
