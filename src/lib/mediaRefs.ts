/** Report ↔ media references (fields.media_refs) — id-bearing lines.
 *
 *  The report editor's media picker used to write literal "title — url" text
 *  into the media_refs textarea, so renaming a photo orphaned every report
 *  that mentioned it. New picks write one `[media:<id>] Title` token line
 *  instead; render/export resolve the id to the row's CURRENT title/url.
 *
 *  Backward compatibility is line-per-line: any line that does not match the
 *  token stays a plain text entry and renders exactly as before, so legacy
 *  reports (and hand-typed notes) are untouched. */

const TOKEN_RE = /^\[media:([0-9a-f-]{16,})\]\s*(.*)$/i

export interface MediaRefEntry {
  /** media.id for token lines; null for legacy/free-text lines. */
  id: string | null
  /** Token label snapshot, or the whole line for legacy entries. */
  label: string
}

/** One picker line: `[media:<id>] Title`. The label is a human fallback for
 *  when the row is deleted or RLS-hidden — display always prefers the live
 *  row's title. */
export function mediaRefLine(id: string, title: string): string {
  return `[media:${id}] ${title}`.trimEnd()
}

/** Split a media_refs blob into entries (blank lines dropped). */
export function parseMediaRefEntries(text: string | null | undefined): MediaRefEntry[] {
  if (!text) return []
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const m = TOKEN_RE.exec(line)
      return m ? { id: m[1], label: m[2] || 'Attachment' } : { id: null, label: line }
    })
}

/** Flatten media_refs to plain text for exports: token lines resolve to the
 *  live "title — url" via the lookup; unresolvable tokens fall back to their
 *  label; legacy lines pass through unchanged. */
export function resolveMediaRefText(
  text: string | null | undefined,
  lookup: (id: string) => { title: string; url: string | null } | null,
): string {
  return parseMediaRefEntries(text)
    .map((e) => {
      if (!e.id) return e.label
      const hit = lookup(e.id)
      if (!hit) return e.label
      return hit.url ? `${hit.title} — ${hit.url}` : hit.title
    })
    .join('\n')
}
