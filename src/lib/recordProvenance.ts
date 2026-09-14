/** Who put a registry record here, and when it last changed.
 *
 *  Every dossier already answered this, and no two answered it the same way:
 *  the narcotic said "Updated 3 Jan · Added by Det. Rowe", the person and the
 *  gang said "Updated 3 Jan · Lead Det. Rowe" — a LEAD, which is an
 *  assignment and not authorship — the vehicle put two bare dates in a
 *  key/value table, and the place, account and indicator said nothing at all.
 *  A reader comparing two dossiers had to learn two vocabularies to ask one
 *  question.
 *
 *  So the answer is computed here, once, and the wording is deliberate:
 *
 *   · AUTHOR, not owner. `created_by` is the member who recorded the row. It
 *     confers nothing — the record is the division's, RLS decides who may
 *     touch it — and the line never implies otherwise.
 *   · An unresolved author id is not an absent one. The roster cache may not
 *     name a member who left, and RLS may not show one at all; either way the
 *     record HAS an author, so the line says the date and admits it cannot
 *     name them rather than quietly reading as "nobody".
 *   · "Updated" appears only when the record actually changed. A row whose
 *     `updated_at` is its `created_at` has not been touched since, and saying
 *     "Updated" there makes an untouched record look maintained.
 *
 *  Pure: it takes a name resolver rather than reaching for the roster, so the
 *  tests state exactly what the roster knew. */
import { fmtDate, timeAgo } from './format'

/** The provenance columns every registry table carries. `indicators` has no
 *  `updated_at`; the field is optional for exactly that reason. */
export interface ProvenanceRecord {
  created_at?: string | null
  created_by?: string | null
  updated_at?: string | null
}

export interface RecordProvenance {
  /** "Added by Det. Rowe · 3 Jan 2026", or the date alone when the author
   *  cannot be named, or null when the record carries no creation date. */
  added: string | null
  /** "Updated 2d ago" — null when the record has not changed since it was
   *  created, or carries no update date. */
  updated: string | null
  /** The record names an author the resolver could not put a name to. The
   *  caller explains this in a tooltip; the line itself never guesses. */
  authorUnknown: boolean
}

/** A record's origin line. `resolve` is the roster lookup (lib/profiles
 *  officerName) — injected so this stays pure and testable. */
export function recordProvenance(
  r: ProvenanceRecord,
  resolve: (id: string | null | undefined) => string | null,
): RecordProvenance {
  const author = r.created_by ? resolve(r.created_by) : null
  const authorUnknown = !!r.created_by && !author

  let added: string | null = null
  if (r.created_at) {
    added = author ? `Added by ${author} · ${fmtDate(r.created_at)}` : `Added ${fmtDate(r.created_at)}`
  } else if (author) {
    added = `Added by ${author}`
  }

  return { added, updated: updatedLine(r), authorUnknown }
}

/** "Updated 2d ago", or null when nothing has changed. A stamp at or before
 *  creation is the row as it was written, not an edit — some tables set both
 *  columns on insert, and one of those is not news. */
function updatedLine(r: ProvenanceRecord): string | null {
  if (!r.updated_at) return null
  const updated = Date.parse(r.updated_at)
  if (Number.isNaN(updated)) return null
  const created = r.created_at ? Date.parse(r.created_at) : NaN
  if (!Number.isNaN(created) && updated <= created) return null
  return `Updated ${timeAgo(r.updated_at)}`
}

/** The whole line, for the places that want one string (exports, tooltips).
 *  Empty when the record records neither fact. */
export function provenanceText(p: RecordProvenance): string {
  return [p.added, p.updated].filter(Boolean).join(' · ')
}
