/** The section index — the client mirror of 20260927120000_document_sections.sql.
 *
 *  ── Why the index is built here and not in SQL ────────────────────────────
 *  Six of the fifteen documents in the library contain no `#` headings at all,
 *  including the 15,891-character CID SOP. Their structure comes from the
 *  renderer's heuristics — a short ALL-CAPS or trailing-colon line is a
 *  heading, the lead line above a pipe table is a heading — and anchors carry a
 *  de-duplication suffix assigned by a counter running across every heading in
 *  document order. Reimplementing that in plpgsql would put a subtle renderer
 *  in a second language, and the day the two disagreed every copied section
 *  link would rot without anyone noticing.
 *
 *  So there is no second parser. `renderDocumentMarkdown()` already returns the
 *  exact headings it emitted, ids included; this module hands that list to the
 *  server. One rule, one implementation, no way to drift.
 *
 *  ── The server does not trust this list ───────────────────────────────────
 *  If a reader submits the index then a reader can lie, and the lie would
 *  surface in OTHER people's search results. So nothing here sends document
 *  TEXT: only anchors and heading titles go over the wire, and the server
 *  slices the section body out of its own stored copy. A heading that is not
 *  really in the document indexes as an empty section — probed live, and the
 *  forged section came back empty while the genuine one carried 39,477
 *  characters of real text.
 */

import { list, rpc } from './db'
import type { Json } from './database.types'
import { renderDocumentMarkdown } from './markdown'

export interface SectionHeading {
  anchor: string
  heading: string
  depth: 2 | 3
}

/** The headings a document will render, in document order. Derived from the
 *  renderer itself rather than re-parsed, which is the whole point. */
export function documentHeadings(body: string | null | undefined): SectionHeading[] {
  return renderDocumentMarkdown(body).headings.map((h) => ({
    anchor: h.id,
    heading: h.text,
    depth: h.level,
  }))
}

/** Rebuild the stored index for a document. Returns the number of sections the
 *  server recorded, or null if it refused (which it does for a document the
 *  caller cannot open). Callers treat failure as unremarkable: a stale index
 *  degrades search, it does not break reading. */
export async function indexSections(
  documentId: string, body: string | null | undefined,
): Promise<number | null> {
  const headings = documentHeadings(body)
  if (!headings.length) return 0
  const res = await rpc('document_sections_index', {
    p_document: documentId,
    // Plain JSON on the wire: anchors and titles only, never document text.
    p_headings: headings as unknown as Json,
  })
  if (res.error) return null
  return typeof res.data === 'number' ? res.data : null
}

/** Whether this reader should rebuild the index — true when the document has
 *  changed since it was last indexed, or was never indexed at all. */
export async function sectionsStale(documentId: string): Promise<boolean> {
  const res = await rpc('document_sections_stale', { p_document: documentId })
  if (res.error) return false
  return res.data === true
}

/** Rebuild the index for a set of documents the caller can read.
 *
 *  The reader repairs one document at a time, which is enough to keep the index
 *  honest once people are reading — but a document nobody has opened since it
 *  was written has never been indexed, and a document rewritten by the Drive
 *  sync is never rendered by anyone at all. This is the deliberate sweep for
 *  both cases. It is not privileged: it indexes exactly the documents the
 *  caller could open by hand, one at a time, and the server refuses the rest. */
export async function reindexLibrary(
  documentIds: string[],
): Promise<{ indexed: number; sections: number; refused: number }> {
  let indexed = 0, sections = 0, refused = 0
  for (const id of documentIds) {
    const rows = await list('documents', { eq: { id }, select: 'id,content', limit: 1 })
      .catch(() => [])
    const body = (rows[0]?.content as { body?: string } | null)?.body ?? ''
    if (!body) { refused += 1; continue }
    const n = await indexSections(id, body)
    if (n === null) refused += 1
    else { indexed += 1; sections += n }
  }
  return { indexed, sections, refused }
}

// ---------------------------------------------------------------------------
// Section-level search
// ---------------------------------------------------------------------------

export interface SectionHit {
  document_id: string
  document_name: string
  category: string | null
  document_type: string
  status: string
  classification: string
  version_number: number
  effective_at: string | null
  anchor: string
  heading: string
  ordinal: number
  rank: number
  headline: string | null
}

/** Search that answers with a place inside a document rather than a document.
 *  RLS-bounded by construction: the RPC is SECURITY INVOKER over a table whose
 *  visibility is the document's own. */
export async function searchSections(q: string, limit = 20): Promise<SectionHit[]> {
  if (q.trim().length < 2) return []
  const res = await rpc('search_document_sections', { p_query: q.trim(), p_limit: limit })
  if (res.error || !Array.isArray(res.data)) return []
  return res.data as unknown as SectionHit[]
}

/** ts_headline marks matches with [[…]] so the excerpt can be highlighted
 *  without the server emitting markup. Returns alternating plain/marked runs,
 *  starting plain — the same convention the library shelf already uses. */
export function highlightRuns(headline: string | null): string[] {
  if (!headline) return ['']
  return headline.split(/\[\[|\]\]/)
}

/** A citation a reader can check: which document, which section, which version,
 *  and as of when. An answer without those is a quotation with no date on it. */
export function citation(hit: SectionHit): string {
  const when = hit.effective_at
    ? new Date(hit.effective_at).toISOString().slice(0, 10)
    : 'no effective date recorded'
  return `${hit.document_name} — ${hit.heading} (v${hit.version_number}, ${when})`
}

/** Deep link straight to the section, not the top of the document. */
export function sectionHref(hit: SectionHit): string {
  return `/sops?doc=${hit.document_id}#${hit.anchor}`
}
